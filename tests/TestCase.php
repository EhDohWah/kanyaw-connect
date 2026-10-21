<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use RuntimeException;

abstract class TestCase extends BaseTestCase
{
    /**
     * RefreshDatabase empties every table, so a test run must never get anywhere near real data.
     * phpunit.xml forces the test database name; this stops the run if something still got past it
     * (a changed phpunit.xml, a different runner, a typo), before any table is touched.
     */
    protected function setUpTraits()
    {
        $this->refuseToRunAgainstARealDatabase();

        return parent::setUpTraits();
    }

    private function refuseToRunAgainstARealDatabase(): void
    {
        $connection = config('database.default');
        $database = (string) config("database.connections.{$connection}.database");

        if (! str_ends_with($database, '_test')) {
            throw new RuntimeException(
                "Refusing to run the tests: they would use the database \"{$database}\", and the tests empty their database. "
                .'The name of a test database must end in "_test" (phpunit.xml sets kanyaw_connect_test).'
            );
        }
    }
}
