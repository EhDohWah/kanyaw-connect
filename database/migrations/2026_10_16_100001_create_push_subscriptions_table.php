<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('push_subscriptions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            // The login the browser subscribed under. When that token is deleted (logout, expiry,
            // pruning) the subscription goes with it, so a signed-out browser stops getting
            // notifications. personal_access_tokens has an auto-increment id, hence foreignId here.
            $table->foreignId('access_token_id')->nullable()->constrained('personal_access_tokens')->cascadeOnDelete();
            $table->string('endpoint', 2048)->unique(); // the push service's URL for this browser
            $table->string('p256dh_key', 128);          // the browser's public key (base64url)
            $table->text('auth_key');                   // the browser's auth secret; stored encrypted
            $table->timestamps(6);

            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('push_subscriptions');
    }
};
