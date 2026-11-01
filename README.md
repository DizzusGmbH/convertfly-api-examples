# ConvertFly API examples

Working examples for the [ConvertFly](https://convertfly.io) file conversion API: documents, images, video, audio, ebooks and archives, converted through a REST API.

- Full reference: [convertfly.io/docs/api](https://convertfly.io/docs/api)
- OpenAPI description: [convertfly.io/api/v1/openapi.json](https://convertfly.io/api/v1/openapi.json)

## How a conversion works

A conversion is a **job** made of chained **tasks**:

1. an import task (`import/upload` for a local file, `import/url` for a file already online);
2. a processing task (`convert`, with an `output_format`);
3. an export task (`export/url`), which returns a download link.

Then call `GET /jobs/{id}/wait`: it answers as soon as the job is `finished` or `error`, or with `202` after about 30 seconds, in which case you call it again. You can also register a webhook (`job.finished`, `job.failed`). The download link in the export result is valid for 1 hour.

```json
POST https://convertfly.io/api/v1/jobs
Authorization: Bearer cvfly_sk_...

{
  "tasks": {
    "import":  { "operation": "import/url", "url": "https://example.com/photo.png" },
    "convert": { "operation": "convert", "input": "import", "output_format": "pdf" },
    "export":  { "operation": "export/url", "input": "convert" }
  }
}
```

## Examples

| Language | File | What it does |
|---|---|---|
| Python | [`examples/python/convert.py`](examples/python/convert.py) | Uploads a local file, converts it, downloads the result |
| Node.js 18+ | [`examples/node/convert.mjs`](examples/node/convert.mjs) | Same flow, no dependencies |
| curl 7.76+ and jq | [`examples/curl/convert-url.sh`](examples/curl/convert-url.sh) | Converts a file from a URL and prints the download link |

```bash
export CONVERTFLY_API_KEY=cvfly_sk_...
python examples/python/convert.py report.docx pdf
node examples/node/convert.mjs photo.heic jpg
./examples/curl/convert-url.sh https://example.com/data.xlsx csv
```

The list of supported operations and formats is available from `GET /operations`.

## API key

Create a key from your ConvertFly dashboard (**API Keys**). The full key is shown only once. Keep it out of source control: the examples read it from the `CONVERTFLY_API_KEY` environment variable.

Requests are rate-limited per key (100 requests per hour by default). Every response carries `X-RateLimit-*` and `X-Credits-Remaining` headers; processing tasks consume credits.

## Files and privacy

Uploaded and converted files are deleted 24 hours after upload. ConvertFly is operated by Dizzus GmbH, Zug, Switzerland.

## License

The examples in this repository are released under the [MIT License](LICENSE).
