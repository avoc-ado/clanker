import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface ContextPackEntry {
  title: string;
  content: string;
}

export interface ContextPack {
  entries: ContextPackEntry[];
}

const readOptionalFile = async ({ path }: { path: string }): Promise<string | null> => {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
};

const readPlanDocs = async ({ repoRoot }: { repoRoot: string }): Promise<ContextPackEntry[]> => {
  const docsDir = join(repoRoot, "docs");
  try {
    const files = await readdir(docsDir);
    const planDocs = files.filter((file) => file.startsWith("plan-") && file.endsWith(".md"));
    const contents = await Promise.all(
      planDocs.map(async (file) => ({
        title: file,
        content: (await readOptionalFile({ path: join(docsDir, file) })) ?? "",
      })),
    );
    return contents.filter((entry) => entry.content.length > 0);
  } catch {
    return [];
  }
};

const readHistorySummaries = async ({
  historyDir,
}: {
  historyDir: string;
}): Promise<ContextPackEntry[]> => {
  try {
    const files = await readdir(historyDir);
    const summaries = files.filter((file) => file.endsWith(".md")).slice(-5);
    const contents = await Promise.all(
      summaries.map(async (file) => ({
        title: file,
        content: (await readOptionalFile({ path: join(historyDir, file) })) ?? "",
      })),
    );
    return contents.filter((entry) => entry.content.length > 0);
  } catch {
    return [];
  }
};

export const buildContextPack = async ({
  repoRoot,
  historyDir,
}: {
  repoRoot: string;
  historyDir: string;
}): Promise<ContextPack> => {
  const [planDocs, history] = await Promise.all([
    readPlanDocs({ repoRoot }),
    readHistorySummaries({ historyDir }),
  ]);

  return {
    entries: [...planDocs, ...history],
  } satisfies ContextPack;
};
