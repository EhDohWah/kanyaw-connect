<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rooms', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->enum('type', ['instant', 'scheduled'])->default('instant');
            $table->string('name');
            $table->text('description')->nullable();
            $table->foreignUuid('host_id')->constrained('users');
            $table->foreignUuid('chat_id')->nullable()->constrained()->nullOnDelete();
            $table->string('password')->nullable(); // hashed
            $table->boolean('waiting_room_enabled')->default(false);
            $table->boolean('is_locked')->default(false);
            $table->unsignedSmallInteger('max_participants')->default(50);
            $table->timestamp('scheduled_at', 6)->nullable();
            $table->unsignedSmallInteger('duration_minutes')->nullable();
            $table->enum('status', ['waiting', 'active', 'ended'])->default('waiting');
            $table->timestamp('started_at', 6)->nullable();
            $table->timestamp('ended_at', 6)->nullable();
            $table->string('livekit_room_name')->unique();
            $table->boolean('recording_enabled')->default(false);
            $table->jsonb('settings')->default(DB::raw("'{}'::jsonb"));
            $table->timestamps(6);
            $table->softDeletes();

            $table->index(['host_id', 'status']);
            $table->index('chat_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rooms');
    }
};
