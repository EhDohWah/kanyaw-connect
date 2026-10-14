<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('chats', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->enum('type', ['direct', 'group']);
            $table->string('name')->nullable();
            $table->text('description')->nullable();
            $table->string('avatar_path')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->boolean('is_encrypted')->default(false);
            // Sorted "{userA}:{userB}" for direct chats; the unique index prevents duplicate DMs.
            $table->string('direct_key')->nullable()->unique();
            $table->unsignedInteger('member_count')->default(0);
            // Microsecond precision: ordering and unread counts compare these values.
            $table->timestamp('last_message_at', 6)->nullable();
            $table->timestamps(6);
            $table->softDeletes();

            $table->index(['last_message_at', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('chats');
    }
};
