package app

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"strings"
	"testing"

	"github.com/redis/go-redis/v9"
	"github.com/santekno/sdk/testx"
)

// closingConnector is a database whose Close fails with err.
type closingConnector struct{ err error }

func (closingConnector) Connect(context.Context) (driver.Conn, error) {
	return nil, errors.New("no connections")
}
func (closingConnector) Driver() driver.Driver { return nil }
func (c closingConnector) Close() error        { return c.err }

func TestCloseDB(t *testing.T) {
	logger, logs := jsonLogger()
	closeDB(sql.OpenDB(closingConnector{}), logger)
	testx.AssertContains(t, logs.String(), `"level":"INFO","msg":"database closed"`)

	logger, logs = jsonLogger()
	closeDB(sql.OpenDB(closingConnector{err: errors.New("pool busy")}), logger)
	testx.AssertContains(t, logs.String(), `"level":"ERROR","msg":"close database","error":"pool busy"`)
	testx.AssertFalse(t, strings.Contains(logs.String(), "database closed"), "a failed close is not reported as closed")
}

func TestCloseRedis(t *testing.T) {
	rdb := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1"})
	logger, logs := jsonLogger()
	closeRedis(rdb, logger)
	testx.AssertContains(t, logs.String(), `"level":"INFO","msg":"redis closed"`)

	logger, logs = jsonLogger()
	closeRedis(rdb, logger) // closed already
	testx.AssertContains(t, logs.String(), `"level":"ERROR","msg":"close redis"`)
	testx.AssertFalse(t, strings.Contains(logs.String(), "redis closed"))
}
