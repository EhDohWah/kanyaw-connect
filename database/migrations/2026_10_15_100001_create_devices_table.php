<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Public keys only. The matching private keys never leave the user's device.
        Schema::create('devices', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->text('identity_public_key')->unique();   // Ed25519, base64
            $table->text('exchange_public_key');              // X25519, base64
            $table->unsignedInteger('signed_prekey_id');
            $table->text('signed_prekey_public');
            $table->text('signed_prekey_signature');
            $table->timestamp('signed_prekey_rotated_at', 6);
            $table->timestamp('last_active_at', 6)->nullable();
            $table->timestamp('revoked_at', 6)->nullable();
            $table->timestamps(6);

            $table->index(['user_id', 'revoked_at']);
        });

        Schema::create('one_time_prekeys', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('device_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('key_id');
            $table->text('public_key');
            $table->timestamp('claimed_at', 6)->nullable();
            $table->foreignUuid('claimed_by_device_id')->nullable()->constrained('devices')->nullOnDelete();
            $table->timestamp('created_at', 6)->nullable();

            $table->unique(['device_id', 'key_id']);
            $table->index(['device_id', 'claimed_at']);
        });

        // One encrypted copy of a message per recipient device. `ciphertext` and `header` are opaque
        // to the server: stored and returned untouched. `header` is plain json (not jsonb) so its
        // text is kept exactly as sent, in case a client authenticates it.
        Schema::create('message_envelopes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('message_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('recipient_device_id')->constrained('devices')->cascadeOnDelete();
            $table->text('ciphertext');
            $table->json('header');
            $table->timestamps(6);

            $table->unique(['message_id', 'recipient_device_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('message_envelopes');
        Schema::dropIfExists('one_time_prekeys');
        Schema::dropIfExists('devices');
    }
};
