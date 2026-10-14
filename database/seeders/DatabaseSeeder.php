<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     *
     * Every seeded user has the password "password".
     * Later phases extend this with chats and a video room.
     */
    public function run(): void
    {
        foreach (['Saw Eh Doh', 'Naw Paw Say', 'Saw Htoo Lay', 'Naw Mu Moo', 'Saw Kler Wah'] as $i => $name) {
            User::factory()->create([
                'name' => $name,
                'email' => 'user'.($i + 1).'@example.com',
            ]);
        }
    }
}
