import { afterEach, describe, expect, it, vi } from "vitest";
import {
  S3ObjectFile,
  createS3StorageClient,
  fromS3Metadata,
  isS3Provider,
  presignS3,
  s3UrlToObjectPath,
  setS3SdkForTests,
  toS3Metadata,
} from "./s3Storage";

// Minimal stand-ins for the AWS SDK command classes: they just record their input.
class FakeCommand {
  constructor(public input: Record<string, unknown>) {}
}
class HeadObjectCommand extends FakeCommand {}
class GetObjectCommand extends FakeCommand {}
class CopyObjectCommand extends FakeCommand {}
class DeleteObjectCommand extends FakeCommand {}
class PutObjectCommand extends FakeCommand {}

function installFakeSdk(send: (command: FakeCommand) => Promise<unknown>) {
  const presign = vi.fn().mockResolvedValue("https://signed.example/url");
  const client = { send: vi.fn(send) };
  setS3SdkForTests({
    client,
    commands: { HeadObjectCommand, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand, PutObjectCommand },
    presign,
  });
  return { client, presign };
}

afterEach(() => setS3SdkForTests(null));

describe("STORAGE_PROVIDER", () => {
  it("defaults to Google Cloud Storage", () => {
    expect(isS3Provider({})).toBe(false);
    expect(isS3Provider({ STORAGE_PROVIDER: "gcs" })).toBe(false);
  });
  it("enables S3 only when asked", () => {
    expect(isS3Provider({ STORAGE_PROVIDER: "s3" })).toBe(true);
  });
  it("rejects unknown values instead of silently picking a provider", () => {
    expect(() => isS3Provider({ STORAGE_PROVIDER: "azure" })).toThrow(/gcs.*s3/);
  });
});

describe("metadata mapping", () => {
  it("stores the ACL key under a header-safe name and reads it back unchanged", () => {
    const policy = JSON.stringify({ owner: "user_123", visibility: "private" });
    const stored = toS3Metadata({ "custom:aclPolicy": policy });
    expect(Object.keys(stored)).toEqual(["aclpolicy"]);
    expect(fromS3Metadata(stored)).toEqual({ "custom:aclPolicy": policy });
  });
  it("reads an unencoded policy copied in from elsewhere", () => {
    const raw = '{"owner":"u","visibility":"public"}';
    expect(fromS3Metadata({ aclpolicy: raw })["custom:aclPolicy"]).toBe(raw);
  });
});

describe("s3UrlToObjectPath", () => {
  it("handles virtual-hosted style upload URLs", () => {
    expect(
      s3UrlToObjectPath("https://dodolink-media.s3.af-south-1.amazonaws.com/private/uploads/abc?X-Amz-Signature=1"),
    ).toBe("/dodolink-media/private/uploads/abc");
  });
  it("handles path style URLs", () => {
    expect(s3UrlToObjectPath("https://s3.af-south-1.amazonaws.com/dodolink-media/private/uploads/abc")).toBe(
      "/dodolink-media/private/uploads/abc",
    );
  });
  it("ignores Google and non-URL values", () => {
    expect(s3UrlToObjectPath("https://storage.googleapis.com/bucket/x")).toBeNull();
    expect(s3UrlToObjectPath("/objects/abc")).toBeNull();
  });
});

describe("S3ObjectFile", () => {
  it("exists() is false for a missing key and rethrows other errors", async () => {
    installFakeSdk(async () => {
      throw Object.assign(new Error("nope"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
    });
    await expect(new S3ObjectFile("b", "k").exists()).resolves.toEqual([false]);

    installFakeSdk(async () => {
      throw Object.assign(new Error("denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
    });
    await expect(new S3ObjectFile("b", "k").exists()).rejects.toThrow("denied");
  });

  it("getMetadata() returns the real content type and size", async () => {
    installFakeSdk(async () => ({ ContentType: "image/jpeg", ContentLength: 1234, Metadata: {} }));
    const [metadata] = await new S3ObjectFile("b", "k").getMetadata();
    expect(metadata.contentType).toBe("image/jpeg");
    expect(Number(metadata.size)).toBe(1234);
  });

  it("setMetadata() keeps existing metadata and content type", async () => {
    const { client } = installFakeSdk(async command => {
      if (command instanceof HeadObjectCommand) {
        return { ContentType: "image/png", Metadata: { existing: "1" } };
      }
      return {};
    });
    await new S3ObjectFile("bucket", "private/uploads/a b").setMetadata({
      metadata: { "custom:aclPolicy": "{}" },
    });
    const copy = client.send.mock.calls.map(([c]) => c).find(c => c instanceof CopyObjectCommand)!;
    expect(copy.input).toMatchObject({
      Bucket: "bucket",
      Key: "private/uploads/a b",
      CopySource: "bucket/private/uploads/a%20b",
      MetadataDirective: "REPLACE",
      ContentType: "image/png",
    });
    expect(copy.input.Metadata).toEqual({ existing: "1", aclpolicy: "%7B%7D" });
  });

  it("delete() issues DeleteObject", async () => {
    const { client } = installFakeSdk(async () => ({}));
    await new S3ObjectFile("b", "k").delete({ ignoreNotFound: true });
    expect(client.send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
  });

  it("createReadStream() streams the object body", async () => {
    const { Readable } = await import("node:stream");
    installFakeSdk(async () => ({ Body: Readable.from([Buffer.from("hello ")  , Buffer.from("world")]) }));
    const chunks: Buffer[] = [];
    for await (const chunk of new S3ObjectFile("b", "k").createReadStream()) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe("hello world");
  });

  it("createReadStream() surfaces errors to the reader", async () => {
    installFakeSdk(async () => {
      throw new Error("boom");
    });
    const stream = new S3ObjectFile("b", "k").createReadStream();
    await expect((async () => { for await (const _ of stream) { /* drain */ } })()).rejects.toThrow("boom");
  });
});

describe("createS3StorageClient and presigning", () => {
  it("provides bucket(name).file(key)", () => {
    const file = createS3StorageClient().bucket("b").file("k");
    expect(file).toBeInstanceOf(S3ObjectFile);
    expect(file.name).toBe("k");
  });

  it("presigns uploads as PutObject with the expiry", async () => {
    const { presign } = installFakeSdk(async () => ({}));
    await expect(presignS3("b", "private/uploads/x", "PUT", 900)).resolves.toBe("https://signed.example/url");
    const [, command, options] = presign.mock.calls[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({ Bucket: "b", Key: "private/uploads/x" });
    expect(options).toEqual({ expiresIn: 900 });
  });
});
