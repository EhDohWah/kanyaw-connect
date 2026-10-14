<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Who has asked to join, been admitted or denied, and when LiveKit says they were connected.
        // Live media state (camera/mic on, connection quality) is deliberately NOT stored here:
        // clients read it from the LiveKit SDK.
        Schema::create('room_participants', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('room_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->enum('role', ['host', 'co_host', 'participant'])->default('participant');
            $table->enum('admission', ['admitted', 'waiting', 'denied'])->default('admitted');
            // Written only from LiveKit webhooks (the source of truth for who is connected).
            $table->timestamp('joined_at', 6)->nullable();
            $table->timestamp('left_at', 6)->nullable();
            // Written when we hand out a token. Holds a seat for a short while so two people
            // asking for the last seat cannot both succeed before either has connected.
            $table->timestamp('token_issued_at', 6)->nullable();
            $table->timestamps(6);

            $table->unique(['room_id', 'user_id']);
            $table->index(['room_id', 'admission']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('room_participants');
    }
};
