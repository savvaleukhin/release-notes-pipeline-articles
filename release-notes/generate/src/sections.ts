// Section grouping for the generate stage. A breaking entry lands in the
// breaking section only, whatever its kind — that section is the headline.

import type { ChangeEntry } from "./changes.js";

export interface ReleaseSections {
  breaking: ChangeEntry[];
  features: ChangeEntry[];
  fixes: ChangeEntry[];
  docs: ChangeEntry[];
  dependencies: ChangeEntry[];
  other: ChangeEntry[];
}

export function sectionize(entries: ChangeEntry[]): ReleaseSections {
  const sections: ReleaseSections = {
    breaking: [],
    features: [],
    fixes: [],
    docs: [],
    dependencies: [],
    other: [],
  };
  for (const entry of entries) {
    if (entry.breaking) {
      sections.breaking.push(entry);
      continue;
    }
    switch (entry.kind) {
      case "feature":
        sections.features.push(entry);
        break;
      case "fix":
        sections.fixes.push(entry);
        break;
      case "docs":
        sections.docs.push(entry);
        break;
      case "dependencies":
        sections.dependencies.push(entry);
        break;
      default:
        sections.other.push(entry);
    }
  }
  return sections;
}
