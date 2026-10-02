import { requireArjun } from "@/lib/auth";
import { UploadForm } from "@/components/UploadForm";

export default async function UploadPage() {
  await requireArjun();
  return (
    <>
      <h1>Upload CVs</h1>
      <p className="lede">
        PDF, DOCX or TXT, up to 60 at a time. Each file is parsed on the server and name, email and phone are split
        into a private field before anything reaches Gemini.
      </p>
      <UploadForm />
    </>
  );
}
