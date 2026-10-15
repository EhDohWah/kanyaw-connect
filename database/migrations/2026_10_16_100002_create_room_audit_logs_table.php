<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Who did what to a video room. Written once, never changed. It deliberately records no IP
        // address or device details: the question it answers is "which host or co-host did this".
        Schema::create('room_audit_logs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('room_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('actor_id')->nullable()->constrained('users')->nullOnDelete();       // null = the system
            $table->foreignUuid('target_user_id')->nullable()->constrained('users')->nullOnDelete(); // who it was done to
            $table->string('action', 40);
            $table->jsonb('metadata')->default(DB::raw("'{}'::jsonb"));
            $table->timestamp('created_at', 6);

            $table->index(['room_id', 'created_at', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('room_audit_logs');
    }
};
