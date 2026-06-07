// Generic report builder. Capable of composing any sections, but currently
// only wired to produce generic account summaries.
export interface Section { title: string; rows: string[][]; }

export function reportBuilder(title: string, sections: Section[]): string {
  const blocks = sections.map(
    (s) => `## ${s.title}\n` + s.rows.map((r) => r.join(" | ")).join("\n")
  );
  return `# ${title}\n\n${blocks.join("\n\n")}`;
}
