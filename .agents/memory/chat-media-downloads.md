---
name: Chat media downloads
description: Phone-saving requirements and MIME detection for opaque chat attachment URLs.
---

Chat photo and video messages need an explicit download control for saving the attachment to the user's phone, for both incoming and outgoing media.

**Why:** The user requested a download icon in chat for images and videos, not just an attachment viewer.

**How to apply:** On native devices, save to the photo/video library with permission requested only when the user taps download. Saving does not justify requesting broad read access to their existing media. On web, initiate a browser download and distinguish that from confirmed native saving. Show failures inline and allow retries.

Use the stored file's MIME type, not just its URL, to identify attachments and choose download extensions.

**Why:** Upload paths are opaque UUIDs without video filenames. Filename-only detection rendered video attachments as images.

**How to apply:** Detect type through metadata-only HEAD requests while preserving the normal stored-media validation. Avoid downloading an entire large video merely to discover its type. Preserve real formats such as PNG and QuickTime rather than renaming every download to JPEG or MP4.
