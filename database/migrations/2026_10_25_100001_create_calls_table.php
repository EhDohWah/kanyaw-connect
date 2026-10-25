<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // A one-to-one call in a direct chat. The media runs in a two-seat room (room_id); this row
        // holds what a room has no word for: who rang whom, the ringing, and how it ended.
        Schema::create('calls', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('chat_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('room_id')->unique()->constrained()->cascadeOnDelete();
            $table->foreignUuid('caller_id')->constrained('users')->cascadeOnDelete();
            $table->foreignUuid('callee_id')->constrained('users')->cascadeOnDelete();
            $table->enum('kind', ['voice', 'video']);
            $table->enum('status', ['ringing', 'ongoing', 'ended', 'declined', 'missed'])->default('ringing');
            $table->enum('end_reason', ['hung_up', 'connection_lost', 'cancelled', 'no_answer'])->nullable();
            $table->timestamp('ring_expires_at', 6);
            $table->timestamp('answered_at', 6)->nullable();
            $table->timestamp('ended_at', 6)->nullable();
            $table->timestamps(6);

            $table->index(['caller_id', 'status']);
            $table->index(['callee_id', 'status']);
            $table->index('chat_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('calls');
    }
};
