/**
 * Reusable Markdown and prose renderer for assistant answers across Margin chat interfaces.
 * Formats headings, fenced code blocks, unordered/ordered lists, blockquotes, inline formatting,
 * and optional grounded citation pills.
 */

import { type ReactNode } from "react";
import type { CitationResponse } from "../../types/api_contract_types";

export interface FormattedAssistantAnswerProps {
  content: string;
  citations?: CitationResponse[];
  onNavigateToCitation?: (citation: CitationResponse) => void;
  className?: string;
}

function extractCleanClaimText(rawText: string): string {
  return rawText
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\[\d+(?:\s*(?:,|[-–—‑])\s*\d+)*\]/g, "")
    .replace(/\*{1,3}|`/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}

function expandCitationGroup(groupText: string): number[] {
  const indices: number[] = [];
  for (const rawPart of groupText.split(",")) {
    const token = rawPart.trim();
    const rangeMatch = /^(\d{1,3})\s*[-–—‑]\s*(\d{1,3})$/.exec(token);
    if (rangeMatch?.[1] && rangeMatch?.[2]) {
      const start = Number.parseInt(rangeMatch[1], 10);
      const end = Number.parseInt(rangeMatch[2], 10);
      if (Number.isFinite(start) && Number.isFinite(end) && start <= end && end - start <= 20) {
        for (let n = start; n <= end; n += 1) {
          indices.push(n);
        }
      }
      continue;
    }
    const num = Number.parseInt(token, 10);
    if (Number.isFinite(num)) {
      indices.push(num);
    }
  }
  return indices;
}

function splitMarkdownTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) {
    trimmed = trimmed.slice(1);
  }
  if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function isMarkdownTableSeparator(line: string, expectedCols: number): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) {
    return false;
  }
  const cells = splitMarkdownTableRow(trimmed);
  if (cells.length === 0 || (expectedCols > 0 && cells.length !== expectedCols)) {
    return false;
  }
  return cells.every((cell) => /^:?-{1,}:?$/.test(cell));
}

function isMarkdownTableStart(lines: string[], index: number): boolean {
  const header = (lines[index] ?? "").trim();
  const separator = (lines[index + 1] ?? "").trim();
  if (!header.includes("|") || !separator.includes("|")) {
    return false;
  }
  const headerCells = splitMarkdownTableRow(header);
  return headerCells.length >= 1 && isMarkdownTableSeparator(separator, headerCells.length);
}

function parseTableAlignments(separatorLine: string): Array<"left" | "center" | "right"> {
  return splitMarkdownTableRow(separatorLine).map((cell) => {
    if (cell.startsWith(":") && cell.endsWith(":")) {
      return "center";
    }
    if (cell.endsWith(":")) {
      return "right";
    }
    return "left";
  });
}

function renderInlineFormatting(
  text: string,
  citations: CitationResponse[],
  onNavigateToCitation: (citation: CitationResponse) => void,
  keyPrefix: string,
  claimContextText?: string,
): ReactNode[] {
  const resolvedClaimContext = claimContextText ?? extractCleanClaimText(text);
  const tokenRegex =
    /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[\d+(?:\s*(?:,|[-–—‑])\s*\d+)*\]|<br\s*\/?>)/gi;
  const parts = text.split(tokenRegex);

  return parts.filter(Boolean).map((part, idx) => {
    const key = `${keyPrefix}-${idx}`;

    if (/^<br\s*\/?>$/i.test(part)) {
      return <br key={key} />;
    }

    if (part.startsWith("***") && part.endsWith("***") && part.length > 6) {
      return (
        <strong key={key} className="font-semibold italic text-on-surface">
          {renderInlineFormatting(
            part.slice(3, -3),
            citations,
            onNavigateToCitation,
            key,
            resolvedClaimContext,
          )}
        </strong>
      );
    }

    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={key} className="font-semibold text-on-surface">
          {renderInlineFormatting(
            part.slice(2, -2),
            citations,
            onNavigateToCitation,
            key,
            resolvedClaimContext,
          )}
        </strong>
      );
    }

    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return (
        <em key={key} className="italic">
          {renderInlineFormatting(
            part.slice(1, -1),
            citations,
            onNavigateToCitation,
            key,
            resolvedClaimContext,
          )}
        </em>
      );
    }

    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={key}
          className="px-1.5 py-0.5 rounded bg-surface-container font-code-sm text-[12px] text-primary"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    const citationMatch = /^\[(\d+(?:\s*(?:,|[-–—‑])\s*\d+)*)\]$/.exec(part);
    if (citationMatch?.[1]) {
      const indices = expandCitationGroup(citationMatch[1]);

      return (
        <span key={key} className="inline-flex items-center gap-0.5 ml-0.5 align-baseline">
          {indices.map((citationIdx) => {
            const matched = citations.find((c) => c.citation_index === citationIdx);
            if (!matched) {
              return (
                <span
                  key={`${key}-c-${citationIdx}`}
                  className="inline-flex items-center px-1.5 py-0.5 rounded bg-surface-container font-code-sm text-[10px] font-medium text-on-surface-variant"
                >
                  [{citationIdx}]
                </span>
              );
            }
            return (
              <button
                key={`${key}-c-${citationIdx}`}
                type="button"
                onClick={() => onNavigateToCitation(matched)}
                title={`${matched.document_filename}${
                  matched.page_number !== null ? ` — Page ${matched.page_number}` : ""
                }`}
                className="inline-flex items-center justify-center px-1.5 py-0.5 rounded bg-primary-fixed/65 hover:bg-primary text-primary hover:text-on-primary font-code-sm text-[10px] font-semibold transition-colors cursor-pointer"
              >
                [{citationIdx}]
              </button>
            );
          })}
        </span>
      );
    }

    return part;
  });
}

function normalizeLegacyCitationTokens(rawContent: string): string {
  if (!rawContent.includes("【") && !rawContent.includes("†")) {
    return rawContent;
  }
  return rawContent.replace(
    /(?:【\s*(\d{1,3}(?:\s*(?:,|[-–—‑])\s*\d{1,3})*)(?:\s*†[^】]*)?\s*】|\[\s*(\d{1,3}(?:\s*(?:,|[-–—‑])\s*\d{1,3})*)\s*†[^\]\n]*\])(?:[ \t]+([.,;:!?]))?/g,
    (_full, lenticularIdx: string | undefined, bracketIdx: string | undefined, punct: string | undefined) =>
      `[${lenticularIdx ?? bracketIdx ?? ""}]${punct ?? ""}`,
  );
}

export function FormattedAssistantAnswer({
  content,
  citations = [],
  onNavigateToCitation = () => {},
  className = "",
}: FormattedAssistantAnswerProps) {
  const lines = normalizeLegacyCitationTokens(content).replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];

  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i] ?? "";
    const trimmed = rawLine.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Fenced code block
    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[i] ?? "");
        i += 1;
      }
      i += 1; // skip closing fence
      blocks.push(
        <pre
          key={`code-${i}`}
          className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/30 font-code-sm text-xs text-on-surface overflow-x-auto"
        >
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Markdown Heading (#..######)
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (headingMatch?.[2]) {
      const level = headingMatch[1]?.length ?? 3;
      const headingText = headingMatch[2];
      blocks.push(
        <h4
          key={`h-${i}`}
          className={`font-headline-sm font-semibold text-on-surface ${
            level <= 2 ? "text-[15px] pt-2" : "text-[13.5px] pt-1.5"
          }`}
        >
          {renderInlineFormatting(
            headingText,
            citations,
            onNavigateToCitation,
            `h-${i}`,
          )}
        </h4>,
      );
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^(?:---|\*\*\*|___)$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${i}`} className="border-outline-variant/25 my-2" />);
      i += 1;
      continue;
    }

    // Unordered list (*, -, •)
    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length) {
        const candidate = (lines[i] ?? "").trim();
        const bulletMatch = /^[-*•]\s+(.+)$/.exec(candidate);
        if (!bulletMatch?.[1]) {
          break;
        }
        items.push(bulletMatch[1]);
        i += 1;
      }
      blocks.push(
        <ul
          key={`ul-${i}`}
          className="space-y-1.5 pl-4 list-disc marker:text-primary/80 text-on-surface"
        >
          {items.map((itemText, idx) => (
            <li key={`ul-${i}-${idx}`} className="pl-0.5 leading-relaxed">
              {renderInlineFormatting(
                itemText,
                citations,
                onNavigateToCitation,
                `ul-${i}-${idx}`,
              )}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list (1., 2.)
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length) {
        const candidate = (lines[i] ?? "").trim();
        const orderedMatch = /^\d+[.)]\s+(.+)$/.exec(candidate);
        if (!orderedMatch?.[1]) {
          break;
        }
        items.push(orderedMatch[1]);
        i += 1;
      }
      blocks.push(
        <ol
          key={`ol-${i}`}
          className="space-y-1.5 pl-5 list-decimal marker:text-primary marker:font-semibold text-on-surface"
        >
          {items.map((itemText, idx) => (
            <li key={`ol-${i}-${idx}`} className="pl-0.5 leading-relaxed">
              {renderInlineFormatting(
                itemText,
                citations,
                onNavigateToCitation,
                `ol-${i}-${idx}`,
              )}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    // Blockquote (> ...)
    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith(">")) {
        quoteLines.push((lines[i] ?? "").trim().replace(/^>\s?/, ""));
        i += 1;
      }
      const quoteText = quoteLines.join(" ");
      blocks.push(
        <blockquote
          key={`bq-${i}`}
          className="border-l-2 border-primary/60 pl-3 py-1 italic text-on-surface-variant bg-surface-container-low/60 rounded-r leading-relaxed"
        >
          {renderInlineFormatting(
            quoteText,
            citations,
            onNavigateToCitation,
            `bq-${i}`,
          )}
        </blockquote>,
      );
      continue;
    }

    // Markdown Table (| col | ... | + separator row |---|---|)
    if (isMarkdownTableStart(lines, i)) {
      const tableStartIdx = i;
      const headerCells = splitMarkdownTableRow(lines[i] ?? "");
      const alignments = parseTableAlignments(lines[i + 1] ?? "");
      i += 2;

      const bodyRows: string[][] = [];
      while (i < lines.length) {
        const candidate = (lines[i] ?? "").trim();
        if (
          !candidate ||
          !candidate.includes("|") ||
          candidate.startsWith("```") ||
          /^(#{1,4})\s+/.test(candidate) ||
          candidate.startsWith(">")
        ) {
          break;
        }
        const rowCells = splitMarkdownTableRow(candidate);
        const normalizedRow = headerCells.map((_, colIdx) => rowCells[colIdx] ?? "");
        bodyRows.push(normalizedRow);
        i += 1;
      }

      const alignClass = (colIdx: number) => {
        const align = alignments[colIdx] ?? "left";
        if (align === "center") return "text-center";
        if (align === "right") return "text-right";
        return "text-left";
      };

      blocks.push(
        <div
          key={`table-${tableStartIdx}`}
          className="w-full max-w-full overflow-x-auto rounded-lg border border-outline-variant/35 bg-surface-container-lowest my-2"
        >
          <table className="w-full border-collapse text-xs">
            <thead className="bg-surface-container-low/80 border-b border-outline-variant/30">
              <tr>
                {headerCells.map((cell, colIdx) => (
                  <th
                    key={`th-${tableStartIdx}-${colIdx}`}
                    className={`px-3 py-2 font-label-sm font-semibold text-on-surface align-top ${alignClass(colIdx)}`}
                  >
                    {renderInlineFormatting(
                      cell,
                      citations,
                      onNavigateToCitation,
                      `th-${tableStartIdx}-${colIdx}`,
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/20">
              {bodyRows.map((row, rowIdx) => (
                <tr key={`tr-${tableStartIdx}-${rowIdx}`} className="hover:bg-surface-container-low/40">
                  {row.map((cell, colIdx) => (
                    <td
                      key={`td-${tableStartIdx}-${rowIdx}-${colIdx}`}
                      className={`px-3 py-2 text-on-surface/90 leading-relaxed align-top ${alignClass(colIdx)}`}
                    >
                      {renderInlineFormatting(
                        cell,
                        citations,
                        onNavigateToCitation,
                        `td-${tableStartIdx}-${rowIdx}-${colIdx}`,
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Standard paragraph (collect consecutive non-special lines)
    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const candidate = (lines[i] ?? "").trim();
      if (
        !candidate ||
        candidate.startsWith("```") ||
        /^(#{1,6})\s+/.test(candidate) ||
        /^(?:---|\*\*\*|___)$/.test(candidate) ||
        /^[-*•]\s+/.test(candidate) ||
        /^\d+[.)]\s+/.test(candidate) ||
        candidate.startsWith(">") ||
        isMarkdownTableStart(lines, i)
      ) {
        break;
      }
      paragraphLines.push(candidate);
      i += 1;
    }

    const paragraphText = paragraphLines.join(" ");
    blocks.push(
      <p key={`p-${i}`} className="leading-relaxed text-on-surface">
        {renderInlineFormatting(
          paragraphText,
          citations,
          onNavigateToCitation,
          `p-${i}`,
        )}
      </p>,
    );
  }

  return (
    <div
      className={`min-w-0 w-full break-words font-body-default text-body-default space-y-2.5 ${className}`}
    >
      {blocks}
    </div>
  );
}

