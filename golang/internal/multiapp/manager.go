package multiapp

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"sync"

	"rocket-backend/internal/config"
	"rocket-backend/internal/instrument"
	"rocket-backend/internal/metadata"
	"rocket-backend/internal/storage"
	"rocket-backend/internal/store"
)

// AppManager manages the lifecycle of per-app resources.
type AppManager struct {
	mu          sync.RWMutex
	apps        map[string]*AppContext
	mgmtStore   *store.Store
	dbConfig    config.DatabaseConfig
	poolSize    int
	fileStorage storage.FileStorage
	maxFileSize int64
	instrConfig config.InstrumentationConfig
}

// NewAppManager creates an AppManager backed by the management database.
func NewAppManager(mgmtStore *store.Store, dbCfg config.DatabaseConfig, appPoolSize int, fs storage.FileStorage, maxFileSize int64, instrCfg config.InstrumentationConfig) *AppManager {
	return &AppManager{
		apps:        make(map[string]*AppContext),
		mgmtStore:   mgmtStore,
		dbConfig:    dbCfg,
		poolSize:    appPoolSize,
		fileStorage: fs,
		maxFileSize: maxFileSize,
		instrConfig: instrCfg,
	}
}

// Get returns the AppContext for the given app, lazy-initializing on cache miss.
func (m *AppManager) Get(ctx context.Context, appName string) (*AppContext, error) {
	m.mu.RLock()
	ac, ok := m.apps[appName]
	m.mu.RUnlock()
	if ok {
		return ac, nil
	}

	// Cache miss — look up in _apps and initialize
	return m.initApp(ctx, appName)
}

// Create provisions a new app: creates database, bootstraps, caches.
// dbDriver can be "postgres" or "sqlite"; if empty, defaults to the server's configured driver.
func (m *AppManager) Create(ctx context.Context, name, displayName, dbDriver string) (*AppContext, error) {
	if dbDriver == "" {
		dbDriver = m.dbConfig.Driver
		if dbDriver == "" {
			dbDriver = "postgres"
		}
	}
	dbName := "rocket_" + name
	jwtSecret := generateJWTSecret()

	// Create the database using the app's chosen driver
	appDialect := store.NewDialect(dbDriver)
	if err := appDialect.CreateDatabase(ctx, m.mgmtStore.DB, dbName, m.dbConfig.Path); err != nil {
		return nil, fmt.Errorf("create database %s: %w", dbName, err)
	}

	// Register in _apps (with db_driver)
	pb := m.mgmtStore.Dialect.NewParamBuilder()
	_, err := m.mgmtStore.DB.ExecContext(ctx,
		fmt.Sprintf("INSERT INTO _apps (name, display_name, db_name, db_driver, jwt_secret) VALUES (%s, %s, %s, %s, %s)",
			pb.Add(name), pb.Add(displayName), pb.Add(dbName), pb.Add(dbDriver), pb.Add(jwtSecret)),
		pb.Params()...)
	if err != nil {
		// Clean up: drop the database if registration fails
		_ = appDialect.DropDatabase(ctx, m.mgmtStore.DB, dbName, m.dbConfig.Path)
		return nil, fmt.Errorf("register app: %w", err)
	}

	// Connect to the new database using the app's driver
	appCfg := m.appDBConfig(dbDriver, dbName)
	appStore, err := store.NewWithPoolSize(ctx, appCfg, m.poolSize)
	if err != nil {
		return nil, fmt.Errorf("connect to app database %s: %w", dbName, err)
	}

	// Bootstrap system tables + seed admin user
	if err := appStore.Bootstrap(ctx); err != nil {
		appStore.Close()
		return nil, fmt.Errorf("bootstrap app %s: %w", name, err)
	}

	// Build app context
	reg := metadata.NewRegistry()
	if err := metadata.LoadAll(ctx, appStore.DB, reg); err != nil {
		log.Printf("WARN: Failed to load metadata for app %s: %v", name, err)
	}

	ac := &AppContext{
		Name:        name,
		DBName:      dbName,
		JWTSecret:   jwtSecret,
		Store:       appStore,
		Registry:    reg,
		fileStorage: m.fileStorage,
		maxFileSize: m.maxFileSize,
	}
	if m.instrConfig.Enabled {
		ac.EventBuffer = instrument.NewEventBuffer(appStore.DB, appStore.Dialect, m.instrConfig.BufferSize, m.instrConfig.FlushIntervalMs)
	}
	ac.BuildHandlers()

	m.mu.Lock()
	m.apps[name] = ac
	m.mu.Unlock()

	return ac, nil
}

// Delete tears down an app: closes pool, drops database, removes from _apps.
func (m *AppManager) Delete(ctx context.Context, name string) error {
	m.mu.Lock()
	ac, ok := m.apps[name]
	if ok {
		if ac.EventBuffer != nil {
			ac.EventBuffer.Stop()
		}
		ac.Store.Close()
		delete(m.apps, name)
	}
	m.mu.Unlock()

	// Look up db_name and db_driver from _apps
	var dbName, dbDriver string
	pb := m.mgmtStore.Dialect.NewParamBuilder()
	err := m.mgmtStore.DB.QueryRowContext(ctx,
		fmt.Sprintf("SELECT db_name, db_driver FROM _apps WHERE name = %s", pb.Add(name)),
		pb.Params()...).Scan(&dbName, &dbDriver)
	if err != nil {
		return fmt.Errorf("app not found: %s", name)
	}

	// Remove from _apps
	pb2 := m.mgmtStore.Dialect.NewParamBuilder()
	_, err = m.mgmtStore.DB.ExecContext(ctx,
		fmt.Sprintf("DELETE FROM _apps WHERE name = %s", pb2.Add(name)),
		pb2.Params()...)
	if err != nil {
		return fmt.Errorf("delete app record: %w", err)
	}

	// Drop the database using the app's driver
	appDialect := store.NewDialect(dbDriver)
	if err := appDialect.DropDatabase(ctx, m.mgmtStore.DB, dbName, m.dbConfig.Path); err != nil {
		return fmt.Errorf("drop database %s: %w", dbName, err)
	}

	return nil
}

// List returns all registered apps.
func (m *AppManager) List(ctx context.Context) ([]AppInfo, error) {
	rows, err := store.QueryRows(ctx, m.mgmtStore.DB,
		"SELECT name, display_name, db_name, db_driver, status, created_at, updated_at FROM _apps ORDER BY name",
	)
	if err != nil {
		return nil, err
	}

	apps := make([]AppInfo, 0, len(rows))
	for _, row := range rows {
		dbDriver := "postgres"
		if v, ok := row["db_driver"]; ok && v != nil {
			dbDriver = v.(string)
		}
		apps = append(apps, AppInfo{
			Name:        row["name"].(string),
			DisplayName: row["display_name"].(string),
			DBName:      row["db_name"].(string),
			DBDriver:    dbDriver,
			Status:      row["status"].(string),
			CreatedAt:   row["created_at"],
			UpdatedAt:   row["updated_at"],
		})
	}
	return apps, nil
}

// GetApp returns a single app's info from _apps.
func (m *AppManager) GetApp(ctx context.Context, name string) (*AppInfo, error) {
	pb := m.mgmtStore.Dialect.NewParamBuilder()
	row, err := store.QueryRow(ctx, m.mgmtStore.DB,
		fmt.Sprintf("SELECT name, display_name, db_name, db_driver, status, created_at, updated_at FROM _apps WHERE name = %s", pb.Add(name)),
		pb.Params()...)
	if err != nil {
		return nil, err
	}
	dbDriver := "postgres"
	if v, ok := row["db_driver"]; ok && v != nil {
		dbDriver = v.(string)
	}
	return &AppInfo{
		Name:        row["name"].(string),
		DisplayName: row["display_name"].(string),
		DBName:      row["db_name"].(string),
		DBDriver:    dbDriver,
		Status:      row["status"].(string),
		CreatedAt:   row["created_at"],
		UpdatedAt:   row["updated_at"],
	}, nil
}

// LoadAll eagerly initializes all active apps from _apps at startup.
func (m *AppManager) LoadAll(ctx context.Context) error {
	rows, err := store.QueryRows(ctx, m.mgmtStore.DB,
		"SELECT name, db_name, db_driver, jwt_secret FROM _apps WHERE status = 'active'",
	)
	if err != nil {
		// No rows is fine — no apps yet
		return nil
	}

	for _, row := range rows {
		name := row["name"].(string)
		dbName := row["db_name"].(string)
		dbDriver := m.dbConfig.Driver
		if v, ok := row["db_driver"]; ok && v != nil {
			dbDriver = v.(string)
		}
		jwtSecret := row["jwt_secret"].(string)

		appCfg := m.appDBConfig(dbDriver, dbName)
		appStore, err := store.NewWithPoolSize(ctx, appCfg, m.poolSize)
		if err != nil {
			log.Printf("WARN: Failed to connect to app %s (db: %s): %v", name, dbName, err)
			continue
		}

		// Bootstrap is idempotent
		if err := appStore.Bootstrap(ctx); err != nil {
			log.Printf("WARN: Failed to bootstrap app %s: %v", name, err)
			appStore.Close()
			continue
		}

		reg := metadata.NewRegistry()
		if err := metadata.LoadAll(ctx, appStore.DB, reg); err != nil {
			log.Printf("WARN: Failed to load metadata for app %s: %v", name, err)
		}

		ac := &AppContext{
			Name:        name,
			DBName:      dbName,
			JWTSecret:   jwtSecret,
			Store:       appStore,
			Registry:    reg,
			fileStorage: m.fileStorage,
			maxFileSize: m.maxFileSize,
		}
		if m.instrConfig.Enabled {
			ac.EventBuffer = instrument.NewEventBuffer(appStore.DB, appStore.Dialect, m.instrConfig.BufferSize, m.instrConfig.FlushIntervalMs)
		}
		ac.BuildHandlers()

		m.mu.Lock()
		m.apps[name] = ac
		m.mu.Unlock()

		log.Printf("App loaded: %s (db: %s)", name, dbName)
	}

	return nil
}

// AllContexts returns a snapshot of all active AppContexts (for schedulers).
func (m *AppManager) AllContexts() []*AppContext {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make([]*AppContext, 0, len(m.apps))
	for _, ac := range m.apps {
		result = append(result, ac)
	}
	return result
}

// Close closes all per-app connection pools and event buffers.
func (m *AppManager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, ac := range m.apps {
		if ac.EventBuffer != nil {
			ac.EventBuffer.Stop()
		}
		ac.Store.Close()
	}
	m.apps = make(map[string]*AppContext)
}

// initApp loads a single app from _apps and initializes it.
func (m *AppManager) initApp(ctx context.Context, appName string) (*AppContext, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Double-check after acquiring write lock
	if ac, ok := m.apps[appName]; ok {
		return ac, nil
	}

	var dbName, dbDriver, jwtSecret, status string
	pb := m.mgmtStore.Dialect.NewParamBuilder()
	err := m.mgmtStore.DB.QueryRowContext(ctx,
		fmt.Sprintf("SELECT db_name, db_driver, jwt_secret, status FROM _apps WHERE name = %s", pb.Add(appName)),
		pb.Params()...).Scan(&dbName, &dbDriver, &jwtSecret, &status)
	if err != nil {
		return nil, fmt.Errorf("app not found: %s", appName)
	}
	if status != "active" {
		return nil, fmt.Errorf("app %s is %s", appName, status)
	}

	appCfg := m.appDBConfig(dbDriver, dbName)
	appStore, err := store.NewWithPoolSize(ctx, appCfg, m.poolSize)
	if err != nil {
		return nil, fmt.Errorf("connect to app %s: %w", appName, err)
	}

	reg := metadata.NewRegistry()
	if err := metadata.LoadAll(ctx, appStore.DB, reg); err != nil {
		log.Printf("WARN: Failed to load metadata for app %s: %v", appName, err)
	}

	ac := &AppContext{
		Name:        appName,
		DBName:      dbName,
		JWTSecret:   jwtSecret,
		Store:       appStore,
		Registry:    reg,
		fileStorage: m.fileStorage,
		maxFileSize: m.maxFileSize,
	}
	if m.instrConfig.Enabled {
		ac.EventBuffer = instrument.NewEventBuffer(appStore.DB, appStore.Dialect, m.instrConfig.BufferSize, m.instrConfig.FlushIntervalMs)
	}
	ac.BuildHandlers()
	m.apps[appName] = ac

	return ac, nil
}

// appDBConfig builds a DatabaseConfig for an app database with the given driver.
func (m *AppManager) appDBConfig(driver, dbName string) config.DatabaseConfig {
	cfg := m.dbConfig
	cfg.Driver = driver
	cfg.Name = dbName
	return cfg
}

func generateJWTSecret() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
