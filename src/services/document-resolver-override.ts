import { ChatService } from "./chat.service.js";
import { supabase } from "../config/supabase.js";
import { logger } from "./logger.service.js";

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function filenameMatchesQuestion(question: string, fileName: string): boolean {
  const q = normalize(question);
  const base = normalize(fileName.replace(/\.[^/.]+$/, ""));

  if (!q || !base) return false;

  // Exact document-name match is the primary rule.
  if (q.includes(base)) return true;

  // Explicit acronym support.
  if (base.includes("codigo penal militar") && /\bcpm\b/i.test(q)) return true;
  if (base.includes("regulamento disciplinar") && /\brdpm\b/i.test(q)) return true;
  if (base.includes("processo administrativo disciplinar") && /\bpad\b/i.test(q)) return true;

  return false;
}

const originalResolveDocuments = ChatService.resolveDocuments.bind(ChatService);

ChatService.resolveDocuments = async function resolveDocumentsStrict(
  question: string,
  filters?: { documentId?: string; [key: string]: any }
): Promise<{ documentId: string; filename: string }[]> {
  // Preserve explicit documentId filters exactly as before.
  if (filters?.documentId) {
    return originalResolveDocuments(question, filters);
  }

  try {
    const { data: docs, error } = await supabase
      .from("knowledge_documents")
      .select("id, file_name");

    if (error || !docs) {
      return [];
    }

    const matches = docs
      .filter((doc) => filenameMatchesQuestion(question, doc.file_name ?? ""))
      .map((doc) => ({
        documentId: doc.id,
        filename: doc.file_name ?? "Desconhecido",
      }));

    logger.info("Resolução estrita de documento aplicada", {
      question: "[REDACTED]",
      matches: matches.map((m) => m.filename),
    });

    return matches;
  } catch (error) {
    logger.error("Erro na resolução estrita de documento", error);
    return [];
  }
};
