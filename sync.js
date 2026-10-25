function normalize(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/*
 * Zet een tweecijferig jaartal om naar een volledig jaartal.
 *
 * 24 wordt 2024
 * 25 wordt 2025
 * 98 wordt 1998
 * 99 wordt 1999
 */
function fullSeasonYear(shortYear) {
  const year = Number(shortYear);

  if (!Number.isFinite(year)) {
    return null;
  }

  return year >= 80
    ? 1900 + year
    : 2000 + year;
}

/*
 * Maakt verschillende seizoensnotaties voor de vergelijking gelijk.
 *
 * Voorbeelden die hetzelfde worden:
 *
 * 24/25
 * 24-25
 * 24_25
 * 2024/25
 * 2024-25
 * 2024_25
 * 2024/2025
 * 2024-2025
 * 2024_2025
 *
 * Deze worden intern allemaal:
 *
 * 2024-2025
 *
 * De zichtbare titel van het product wordt niet veranderd.
 */
function normalizeSeasonNotation(value = "") {
  let text = String(value);

  /*
   * Volledig beginjaar en volledig eindjaar.
   *
   * 2024/2025
   * 2024-2025
   * 2024_2025
   */
  text = text.replace(
    /\b((?:19|20)\d{2})\s*[\/_-]\s*((?:19|20)\d{2})\b/g,
    (_, firstYear, secondYear) =>
      `${firstYear}-${secondYear}`
  );

  /*
   * Volledig beginjaar en kort eindjaar.
   *
   * 2024/25 wordt 2024-2025
   * 2024-25 wordt 2024-2025
   * 2024_25 wordt 2024-2025
   * 1999/00 wordt 1999-2000
   */
  text = text.replace(
    /\b((?:19|20)\d{2})\s*[\/_-]\s*(\d{2})\b/g,
    (_, firstYear, shortSecondYear) => {
      const first = Number(firstYear);

      let second =
        Math.floor(first / 100) * 100 +
        Number(shortSecondYear);

      if (second < first) {
        second += 100;
      }

      return `${first}-${second}`;
    }
  );

  /*
   * Kort beginjaar en kort eindjaar.
   *
   * 24/25 wordt 2024-2025
   * 24-25 wordt 2024-2025
   * 24_25 wordt 2024-2025
   * 98/99 wordt 1998-1999
   * 99/00 wordt 1999-2000
   */
  text = text.replace(
    /\b(\d{2})\s*[\/_-]\s*(\d{2})\b/g,
    (
      original,
      shortFirstYear,
      shortSecondYear
    ) => {
      const first =
        fullSeasonYear(
          shortFirstYear
        );

      if (first === null) {
        return original;
      }

      let second =
        Math.floor(first / 100) * 100 +
        Number(shortSecondYear);

      if (second < first) {
        second += 100;
      }

      return `${first}-${second}`;
    }
  );

  return text;
}

/*
 * Deze versie wordt alleen gebruikt om producten
 * onderling te vergelijken.
 *
 * De echte producttitel blijft ongewijzigd.
 */
function comparableProductTitle(title = "") {
  return normalize(
    normalizeSeasonNotation(title)
  );
}
