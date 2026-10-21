#!/bin/sh
# Runs once, when the database volume is first created.
# The tests use their own database (kanyaw_connect_test, set in phpunit.xml) so that running them
# never touches your data.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE DATABASE kanyaw_connect_test OWNER "$POSTGRES_USER";
SQL
