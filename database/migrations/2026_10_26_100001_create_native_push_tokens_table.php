<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('native_push_tokens', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            // The login the phone registered under. Signing out deletes that token, and the
            // registration goes with it. personal_access_tokens has an auto-increment id, hence foreignId.
            $table->foreignId('personal_access_token_id')->constrained('personal_access_tokens')->cascadeOnDelete();
            $table->enum('platform', ['android', 'ios']);
            $table->text('token')->unique();       // the FCM registration token, or the APNs device token
            $table->text('voip_token')->nullable(); // iOS only: the PushKit token, for incoming calls
            $table->string('app_version', 32)->nullable();
            $table->timestamp('last_seen_at', 6);
            $table->timestamps(6);

            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('native_push_tokens');
    }
};
