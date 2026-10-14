<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('messages', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('chat_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('sender_id')->nullable()->constrained('users')->nullOnDelete();
            $table->enum('type', ['text', 'image', 'file', 'voice', 'system'])->default('text');
            $table->text('content')->nullable(); // plaintext chats only
            $table->uuid('reply_to_id')->nullable();
            $table->uuid('client_id')->nullable(); // idempotency key chosen by the sending client
            $table->boolean('is_edited')->default(false);
            $table->timestamp('edited_at', 6)->nullable();
            $table->jsonb('metadata')->default(DB::raw("'{}'::jsonb"));
            $table->timestamps(6);
            $table->softDeletes();

            $table->index(['chat_id', 'created_at', 'id']);
            $table->unique(['sender_id', 'client_id']);
        });

        // Self-reference must be added after the primary key exists (Postgres rejects it inside CREATE).
        Schema::table('messages', function (Blueprint $table) {
            $table->foreign('reply_to_id')->references('id')->on('messages')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('messages');
    }
};
