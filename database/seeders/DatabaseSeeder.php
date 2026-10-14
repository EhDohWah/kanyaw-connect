<?php

namespace Database\Seeders;

use App\Actions\Chats\CreateDirectChat;
use App\Actions\Chats\CreateGroupChat;
use App\Actions\Messages\SendMessage;
use App\Models\Chat;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     *
     * Every seeded user has the password "password". Later phases add a video room.
     */
    public function run(): void
    {
        $users = collect(['Saw Eh Doh', 'Naw Paw Say', 'Saw Htoo Lay', 'Naw Mu Moo', 'Saw Kler Wah'])
            ->map(fn (string $name, int $i) => User::factory()->create([
                'name' => $name,
                'email' => 'user'.($i + 1).'@example.com',
            ]));

        [$eh, $paw, $htoo, $mu, $kler] = $users->all();

        // Two direct chats.
        [$ehPaw] = app(CreateDirectChat::class)->handle($eh, $paw);
        [$ehHtoo] = app(CreateDirectChat::class)->handle($eh, $htoo);

        $this->say($ehPaw, $eh, 'Hello Paw, are you coming to the meeting on Saturday?');
        $this->say($ehPaw, $paw, 'Yes, I will bring the documents.');
        $this->say($ehPaw, $paw, 'Can you share the agenda?');
        $this->say($ehHtoo, $htoo, 'Thank you for your help yesterday!');

        // One group chat: Eh Doh owns it, Paw is an admin.
        $group = app(CreateGroupChat::class)->handle($eh, [
            'name' => 'Community committee',
            'description' => 'Planning and announcements',
            'member_ids' => [$paw->id, $htoo->id, $mu->id, $kler->id],
        ]);
        $group->chatMembers()->where('user_id', $paw->id)->update(['role' => 'admin']);

        $this->say($group, $eh, 'Welcome everyone to the committee chat.');
        $this->say($group, $mu, 'Thank you! Glad to be here.');
        $this->say($group, $kler, 'When is the next meeting?');
    }

    private function say(Chat $chat, User $sender, string $text): void
    {
        app(SendMessage::class)->handle($chat, $sender, [
            'client_id' => (string) Str::uuid(),
            'type' => 'text',
            'content' => $text,
        ]);
    }
}
