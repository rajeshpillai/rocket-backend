package config

import (
	"fmt"

	"github.com/spf13/viper"
)

type InstrumentationConfig struct {
	Enabled        bool    `mapstructure:"enabled"`
	RetentionDays  int     `mapstructure:"retention_days"`
	SamplingRate   float64 `mapstructure:"sampling_rate"`
	BufferSize     int     `mapstructure:"buffer_size"`
	FlushIntervalMs int    `mapstructure:"flush_interval_ms"`
}

type Config struct {
	Server            ServerConfig          `mapstructure:"server"`
	Database          DatabaseConfig        `mapstructure:"database"`
	Storage           StorageConfig         `mapstructure:"storage"`
	Instrumentation   InstrumentationConfig `mapstructure:"instrumentation"`
	JWTSecret         string                `mapstructure:"jwt_secret"`
	PlatformJWTSecret string                `mapstructure:"platform_jwt_secret"`
	AppPoolSize       int                   `mapstructure:"app_pool_size"`
}

type StorageConfig struct {
	Driver      string `mapstructure:"driver"`
	LocalPath   string `mapstructure:"local_path"`
	MaxFileSize int64  `mapstructure:"max_file_size"`
}

type ServerConfig struct {
	Port int `mapstructure:"port"`
}

type DatabaseConfig struct {
	Driver   string `mapstructure:"driver"`
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	User     string `mapstructure:"user"`
	Password string `mapstructure:"password"`
	Name     string `mapstructure:"name"`
	PoolSize int    `mapstructure:"pool_size"`
	Path     string `mapstructure:"path"` // directory for SQLite database files
}

// DSN returns the driver-specific data source name.
func (d DatabaseConfig) DSN() string {
	if d.Driver == "sqlite" {
		return d.Path + "/" + d.Name + ".db"
	}
	return fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable",
		d.User, d.Password, d.Host, d.Port, d.Name)
}

// ConnString returns the PostgreSQL connection string (for backward compatibility).
func (d DatabaseConfig) ConnString() string {
	return fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable",
		d.User, d.Password, d.Host, d.Port, d.Name)
}

// IsSQLite returns true if the driver is sqlite.
func (d DatabaseConfig) IsSQLite() bool {
	return d.Driver == "sqlite"
}

func Load() (*Config, error) {
	viper.SetConfigName("app")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(".")
	viper.AddConfigPath("../..")

	viper.SetDefault("server.port", 8080)
	viper.SetDefault("database.driver", "postgres")
	viper.SetDefault("database.host", "localhost")
	viper.SetDefault("database.port", 5432)
	viper.SetDefault("database.pool_size", 10)
	viper.SetDefault("database.path", "./data")
	viper.SetDefault("jwt_secret", "changeme-secret")
	viper.SetDefault("platform_jwt_secret", "changeme-platform-secret")
	viper.SetDefault("app_pool_size", 5)
	viper.SetDefault("storage.driver", "local")
	viper.SetDefault("storage.local_path", "./uploads")
	viper.SetDefault("storage.max_file_size", 10485760)
	viper.SetDefault("instrumentation.enabled", true)
	viper.SetDefault("instrumentation.retention_days", 7)
	viper.SetDefault("instrumentation.sampling_rate", 1.0)
	viper.SetDefault("instrumentation.buffer_size", 500)
	viper.SetDefault("instrumentation.flush_interval_ms", 100)

	viper.AutomaticEnv()

	if err := viper.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}

	var cfg Config
	if err := viper.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config: %w", err)
	}

	return &cfg, nil
}
