package config

import (
	"fmt"

	"github.com/spf13/viper"
)

type Config struct {
	Server            ServerConfig   `mapstructure:"server"`
	Database          DatabaseConfig `mapstructure:"database"`
	JWTSecret         string         `mapstructure:"jwt_secret"`
	PlatformJWTSecret string         `mapstructure:"platform_jwt_secret"`
	AppPoolSize       int            `mapstructure:"app_pool_size"`
}

type ServerConfig struct {
	Port int `mapstructure:"port"`
}

type DatabaseConfig struct {
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	User     string `mapstructure:"user"`
	Password string `mapstructure:"password"`
	Name     string `mapstructure:"name"`
	PoolSize int    `mapstructure:"pool_size"`
}

func (d DatabaseConfig) ConnString() string {
	return fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable",
		d.User, d.Password, d.Host, d.Port, d.Name)
}

func Load() (*Config, error) {
	viper.SetConfigName("app")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(".")
	viper.AddConfigPath("../..")

	viper.SetDefault("server.port", 8080)
	viper.SetDefault("database.host", "localhost")
	viper.SetDefault("database.port", 5432)
	viper.SetDefault("database.pool_size", 10)
	viper.SetDefault("jwt_secret", "changeme-secret")
	viper.SetDefault("platform_jwt_secret", "changeme-platform-secret")
	viper.SetDefault("app_pool_size", 5)

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
