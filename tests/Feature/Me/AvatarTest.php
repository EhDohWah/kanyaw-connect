<?php

use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

beforeEach(function () {
    Storage::fake('public');
    $this->user = User::factory()->create();
    $this->token = $this->user->createToken('t')->plainTextToken;
});

it('stores the avatar and a 256x256 thumbnail', function () {
    $response = $this->withToken($this->token)->postJson('/api/v1/me/avatar', [
        'avatar' => UploadedFile::fake()->image('me.jpg', 800, 600),
    ]);

    $response->assertOk()
        ->assertJsonStructure(['data' => ['avatar_url', 'avatar_thumb_url']]);

    $user = $this->user->fresh();
    Storage::disk('public')->assertExists($user->avatar_path);
    Storage::disk('public')->assertExists(User::thumbnailPathFor($user->avatar_path));

    [$width, $height] = getimagesizefromstring(
        Storage::disk('public')->get(User::thumbnailPathFor($user->avatar_path))
    );
    expect([$width, $height])->toBe([256, 256]);

    expect($response->json('data.avatar_url'))->toContain($user->avatar_path)
        ->and($response->json('data.avatar_thumb_url'))->toContain('_256.webp');
});

it('replaces the previous avatar and deletes the old files', function () {
    $this->withToken($this->token)->postJson('/api/v1/me/avatar', [
        'avatar' => UploadedFile::fake()->image('one.png', 300, 300),
    ])->assertOk();
    $first = $this->user->fresh()->avatar_path;

    $this->withToken($this->token)->postJson('/api/v1/me/avatar', [
        'avatar' => UploadedFile::fake()->image('two.png', 300, 300),
    ])->assertOk();
    $second = $this->user->fresh()->avatar_path;

    expect($second)->not->toBe($first);
    Storage::disk('public')->assertMissing($first);
    Storage::disk('public')->assertMissing(User::thumbnailPathFor($first));
    Storage::disk('public')->assertExists($second);
});

it('handles small images by scaling them up to fill the thumbnail', function () {
    $this->withToken($this->token)->postJson('/api/v1/me/avatar', [
        'avatar' => UploadedFile::fake()->image('tiny.png', 40, 20),
    ])->assertOk();

    $thumb = User::thumbnailPathFor($this->user->fresh()->avatar_path);
    expect(getimagesizefromstring(Storage::disk('public')->get($thumb)))->toMatchArray([256, 256]);
});

it('rejects files larger than 2 MB', function () {
    $this->withToken($this->token)->postJson('/api/v1/me/avatar', [
        'avatar' => UploadedFile::fake()->image('big.jpg', 600, 600)->size(2049),
    ])->assertUnprocessable()->assertJsonValidationErrors('avatar');
});

it('accepts a file of exactly 2 MB', function () {
    $this->withToken($this->token)->postJson('/api/v1/me/avatar', [
        'avatar' => UploadedFile::fake()->image('ok.jpg', 600, 600)->size(2048),
    ])->assertOk();
});

it('rejects non-image and svg uploads', function (UploadedFile $file) {
    $this->withToken($this->token)->postJson('/api/v1/me/avatar', ['avatar' => $file])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('avatar');

    expect($this->user->fresh()->avatar_path)->toBeNull();
})->with([
    'pdf' => fn () => UploadedFile::fake()->create('doc.pdf', 10, 'application/pdf'),
    'svg' => fn () => UploadedFile::fake()->createWithContent('x.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>'),
    'php disguised' => fn () => UploadedFile::fake()->createWithContent('x.jpg', '<?php echo 1;'),
]);

it('requires the avatar field', function () {
    $this->withToken($this->token)->postJson('/api/v1/me/avatar', [])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('avatar');
});
