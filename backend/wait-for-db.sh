#!/bin/sh
echo "Waiting for PostgreSQL at $PG_HOST:$PG_PORT..."

# pg_isready requires the connection parameters
until pg_isready -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB"; do
  echo "PostgreSQL is unavailable - sleeping"
  sleep 2
done

echo "PostgreSQL is up - executing command"
exec npm start
