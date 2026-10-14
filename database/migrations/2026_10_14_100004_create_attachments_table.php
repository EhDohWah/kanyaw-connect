<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('attachments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            // An attachment is uploaded first and attached to a message afterwards, so it
            // needs its own chat/uploader (for authorization) and a nullable message_id.
            $table->foreignUuid('chat_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('uploader_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('message_id')->nullable()->unique()->constrained()->cascadeOnDelete();
            $table->string('disk', 32);
            $table->string('path');
            $table->string('original_name');
            $table->unsignedBigInteger('size');
            $table->string('mime_type', 127);
            $table->string('thumbnail_path')->nullable();
            $table->text('encrypted_key')->nullable(); // used by encrypted chats in Phase 5
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('attachments');
    }
};
