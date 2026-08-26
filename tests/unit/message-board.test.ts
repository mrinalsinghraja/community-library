import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { READING_LINES, lineForDate } from "@/lib/message-board";

/**
 * The notice board.
 *
 * Two things are worth asserting and both are about the quiet state rather than
 * the posted one, because the quiet state is what a reader sees almost every
 * day and is the half most likely to be got wrong.
 */

describe("the standing greeting", () => {
  it("gives everybody the same line on the same day", () => {
    // A line that changed on every page load would make the card feel like a
    // slot machine, and two children standing together would see two libraries.
    expect(lineForDate("2026-08-26")).toBe(lineForDate("2026-08-26"));
  });

  it("moves on as the days do", () => {
    const week = ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"];
    expect(new Set(week.map((day) => lineForDate(day))).size).toBeGreaterThan(1);
  });

  it("only ever shows a line that is on the list", () => {
    for (let day = 1; day <= 28; day += 1) {
      const iso = `2026-02-${String(day).padStart(2, "0")}`;
      expect(READING_LINES).toContain(lineForDate(iso));
    }
  });

  it("survives an empty list rather than rendering undefined", () => {
    expect(lineForDate("2026-08-26", [])).toBe("");
  });
});

describe("what the lines say", () => {
  /**
   * Written here, not quoted from anywhere.
   *
   * Reading has no shortage of famous sentences about it and every one of them
   * belongs to somebody. A card that republishes an author's words to a few
   * hundred families is a small publication, not a decoration — so there are no
   * attributions on this list, because there is nothing to attribute.
   */
  it("quotes nobody", () => {
    for (const line of READING_LINES) {
      expect(line).not.toMatch(/[—–-]\s*[A-Z][a-z]+ [A-Z]/);
      expect(line).not.toMatch(/["“”]/);
    }
  });

  it("keeps every line short enough for a card on a phone", () => {
    for (const line of READING_LINES) {
      expect(line.length).toBeLessThanOrEqual(90);
    }
  });

  /**
   * The library does not tell children to read more.
   *
   * The whole point of a board on a child's own page is that it is friendly.
   * A line that sets a target turns the one warm surface on the page into
   * homework, and it would do it quietly, one line in ten.
   */
  it("sets nobody a target", () => {
    for (const line of READING_LINES) {
      expect(line).not.toMatch(/\b(must|should|have to|every day|keep up|behind)\b/i);
    }
  });
});

describe("posting", () => {
  it("is the Super Admin's key, checked in the service", () => {
    const service = readFileSync("src/server/services/announcement-service.ts", "utf8");

    expect(service).toContain('requirePermission("announcement.manage")');
    // Reading needs a session and nothing more: this is the library talking to
    // its own families, and the standing greeting is not public copy.
    expect(service).toContain("await requireActor()");
  });

  /**
   * One notice is live at a time. A board that stacked five posts would be a
   * feed, and a feed on a child's page is a thing to scroll past rather than a
   * thing to read.
   */
  it("replaces the live notice rather than queueing behind it", () => {
    const service = readFileSync("src/server/services/announcement-service.ts", "utf8");

    expect(service).toContain("announcement.updateMany");
    expect(service).toMatch(/\$transaction/);
  });

  it("never returns an empty board", () => {
    const service = readFileSync("src/server/services/announcement-service.ts", "utf8");

    // currentNotice returns BoardNotice, not BoardNotice | null. A card that
    // could be blank is a card children learn to stop looking at.
    expect(service).toMatch(/export async function currentNotice\(.*\): Promise<BoardNotice>/);
  });
});
