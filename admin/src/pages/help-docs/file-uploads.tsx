import { Section, CodeBlock, InfoBox, PropsTable, EndpointBlock, C } from "./help-components";

export default function FileUploads() {
  return (
    <div>
      {/* ── Overview ── */}
      <Section title="Overview" id="overview">
        <p>
          Rocket Backend provides a <C>file</C> field type that stores file references as JSONB in
          PostgreSQL. Files are uploaded separately via a dedicated endpoint and then referenced by
          UUID when creating or updating records. This decouples file storage from record writes,
          keeping the write pipeline clean and transactional.
        </p>
        <p>
          The storage layer is built on an abstracted interface with a <strong>local-disk
          implementation</strong> included out of the box. The interface is designed to be S3-ready --
          swap the driver in configuration and the rest of the engine stays unchanged.
        </p>
        <p>
          Each app's files are isolated in their own directory under <C>uploads/{"{app_name}"}/</C>,
          ensuring complete separation between apps in a multi-app deployment.
        </p>
      </Section>

      {/* ── File Field Type ── */}
      <Section title="File Field Type" id="file-field-type">
        <p>
          To add file support to an entity, define a field with <C>type: "file"</C>. The field maps
          to a <C>JSONB</C> column in PostgreSQL and stores structured metadata about the uploaded
          file.
        </p>
        <CodeBlock language="json" title="Entity definition with a file field">{`{
  "name": "product",
  "primary_key": { "field": "id", "type": "uuid", "generated": true },
  "fields": [
    { "name": "name", "type": "string", "required": true },
    { "name": "image", "type": "file" },
    { "name": "manual", "type": "file" }
  ]
}`}</CodeBlock>
        <p>
          When a file field is populated, the stored JSONB value has the following structure:
        </p>
        <CodeBlock language="json" title="Stored file metadata (JSONB)">{`{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "filename": "product-photo.png",
  "size": 245760,
  "mime_type": "image/png"
}`}</CodeBlock>
        <InfoBox type="note">
          <p>
            You never construct this JSONB manually. Upload the file first (getting back a UUID),
            then pass just the UUID when writing to the record. The engine resolves the UUID into
            the full metadata object automatically.
          </p>
        </InfoBox>
      </Section>

      {/* ── Upload Endpoint ── */}
      <Section title="Upload Endpoint" id="upload-endpoint">
        <EndpointBlock method="POST" url="/api/:app/_files/upload" description="Upload a file using multipart/form-data" />
        <p>
          Send a <C>multipart/form-data</C> request with the file in a field named <C>file</C>.
          The server validates the file against the configured maximum size, stores it on disk,
          and records the metadata in the <C>_files</C> system table.
        </p>
        <CodeBlock language="bash" title="Upload a file via curl">{`curl -X POST http://localhost:8080/api/myapp/_files/upload \\
  -H "Authorization: Bearer <token>" \\
  -F "file=@product-photo.png"`}</CodeBlock>
        <CodeBlock language="json" title="Response (201 Created)">{`{
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "filename": "product-photo.png",
    "mime_type": "image/png",
    "size": 245760,
    "url": "/api/myapp/_files/a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  }
}`}</CodeBlock>
        <InfoBox type="tip">
          <p>
            Save the <C>id</C> from the response -- you will use it when creating or updating
            records that have file fields.
          </p>
        </InfoBox>
      </Section>

      {/* ── Using Files in Records ── */}
      <Section title="Using Files in Records" id="using-files-in-records">
        <p>
          When creating or updating a record that has a file field, pass the file's UUID string
          as the field value. The write pipeline automatically resolves the UUID to the full JSONB
          metadata object before storing the record.
        </p>
        <CodeBlock language="bash" title="Create a product with a file reference">{`curl -X POST http://localhost:8080/api/myapp/product \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Widget Pro",
    "image": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  }'`}</CodeBlock>
        <p>
          The engine looks up the UUID in the <C>_files</C> table and stores the resolved metadata:
        </p>
        <CodeBlock language="json" title="What is actually stored in the database">{`{
  "id": "...",
  "name": "Widget Pro",
  "image": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "filename": "product-photo.png",
    "size": 245760,
    "mime_type": "image/png"
  }
}`}</CodeBlock>
        <p>
          You can also update a file field by passing a new UUID. To clear a file field, pass{" "}
          <C>null</C>.
        </p>
        <CodeBlock language="bash" title="Update the image on an existing product">{`curl -X PUT http://localhost:8080/api/myapp/product/<product_id> \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{ "image": "new-file-uuid-here" }'`}</CodeBlock>
        <InfoBox type="warning">
          <p>
            If the UUID does not exist in the <C>_files</C> table, the write will fail with a
            validation error. Always upload the file first, then reference its UUID.
          </p>
        </InfoBox>
      </Section>

      {/* ── Serve / Download ── */}
      <Section title="Serve / Download" id="serve-download">
        <EndpointBlock method="GET" url="/api/:app/_files/:id" description="Stream a file with correct Content-Type" />
        <p>
          This endpoint streams the file directly from storage with the appropriate{" "}
          <C>Content-Type</C> header set based on the file's MIME type. Browsers will render
          images inline and prompt downloads for other file types.
        </p>
        <CodeBlock language="bash" title="Download a file via curl">{`curl http://localhost:8080/api/myapp/_files/a1b2c3d4-e5f6-7890-abcd-ef1234567890 \\
  -H "Authorization: Bearer <token>" \\
  --output product-photo.png`}</CodeBlock>
        <InfoBox type="tip">
          <p>
            The file URL returned in the upload response (and stored in records) can be used
            directly in <C>&lt;img&gt;</C> tags or download links in your frontend application.
          </p>
        </InfoBox>
      </Section>

      {/* ── Delete and List ── */}
      <Section title="Delete and List" id="delete-and-list">
        <p>
          Admin users can delete files and list all uploaded files. Both endpoints require the{" "}
          <C>admin</C> role.
        </p>
        <EndpointBlock method="DELETE" url="/api/:app/_files/:id" description="Delete a file from storage (admin only)" />
        <EndpointBlock method="GET" url="/api/:app/_files" description="List all uploaded files (admin only)" />
        <InfoBox type="warning">
          <p>
            Deleting a file removes it from storage and the <C>_files</C> table. Any records that
            reference the deleted file will still contain the old JSONB metadata, but the file will
            no longer be downloadable. Clean up references in your records as needed.
          </p>
        </InfoBox>
      </Section>

      {/* ── Storage Configuration ── */}
      <Section title="Storage Configuration" id="storage-configuration">
        <p>
          File storage is configured in the <C>app.yaml</C> configuration file under the{" "}
          <C>storage</C> section. The local-disk driver stores files on the server's filesystem
          with per-app isolation.
        </p>
        <CodeBlock language="yaml" title="app.yaml storage configuration">{`storage:
  driver: local          # Storage driver: "local" (S3 support planned)
  local_path: ./uploads  # Base directory for local file storage
  max_file_size: 10485760  # Maximum file size in bytes (10 MB)`}</CodeBlock>
        <p>
          Files for each app are stored in a subdirectory named after the app:
        </p>
        <CodeBlock language="text" title="File storage directory structure">{`uploads/
  myapp/
    a1b2c3d4-e5f6-7890-abcd-ef1234567890.png
    b2c3d4e5-f6a7-8901-bcde-f12345678901.pdf
  otherapp/
    c3d4e5f6-a7b8-9012-cdef-123456789012.jpg`}</CodeBlock>
        <InfoBox type="note">
          <p>
            The <C>max_file_size</C> is enforced during upload. Requests that exceed this limit
            are rejected before the file is written to disk. Adjust this value based on your
            application's needs.
          </p>
        </InfoBox>
      </Section>

      {/* ── System Table ── */}
      <Section title="System Table" id="system-table">
        <p>
          The <C>_files</C> system table tracks all uploaded files. It is created automatically
          in each app's database during bootstrap.
        </p>
        <PropsTable
          columns={["Column", "Type", "Description"]}
          rows={[
            [<C>id</C>, "UUID (PK)", "Unique identifier for the file, generated on upload"],
            [<C>filename</C>, "TEXT", "Original filename as provided during upload"],
            [<C>storage_path</C>, "TEXT", "Path to the file on disk (relative to the storage root)"],
            [<C>mime_type</C>, "TEXT", "MIME type detected from the file (e.g., image/png, application/pdf)"],
            [<C>size</C>, "BIGINT", "File size in bytes"],
            [<C>uploaded_by</C>, "UUID", "ID of the user who uploaded the file (from JWT)"],
            [<C>created_at</C>, "TIMESTAMPTZ", "Timestamp when the file was uploaded"],
          ]}
        />
      </Section>
    </div>
  );
}
