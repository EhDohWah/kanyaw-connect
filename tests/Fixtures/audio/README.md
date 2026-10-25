# Audio fixtures

Real audio-only files, as browsers record voice notes, for the upload type tests. Content detection types the first two
as video (`video/webm`, `video/mp4`), which is what the voice relabel rule is for. Made with ffmpeg:

```bash
ffmpeg -f lavfi -i "sine=frequency=440:duration=1.2" -ac 1 -c:a libopus -b:a 32k voice.webm             # video/webm
ffmpeg -f lavfi -i "sine=frequency=440:duration=1.2" -ac 1 -c:a aac -b:a 32k -f mp4 -brand isom voice.mp4  # video/mp4
ffmpeg -f lavfi -i "sine=frequency=440:duration=1.2" -ac 1 -c:a libopus -b:a 32k voice.ogg              # audio/ogg
ffmpeg -f lavfi -i "testsrc=duration=0.4:size=32x32:rate=5" -c:v libtheora -an video.ogv                # video/ogg
```
