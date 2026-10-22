/**
 * Click-to-sort for server-rendered tables marked `data-sortable`. Each column header becomes a
 * button; a cell sorts by its `data-sort` attribute when it has one (dates, for example),
 * otherwise by its text. A column whose cells all start with a number sorts numerically
 * ("3rd–4th" as 3, "70.0%" as 70); any other column sorts as text, so "100 Thieves" sorts among
 * the names. Empty or dash cells always sort last. Without JavaScript the tables stay as
 * rendered.
 */

const EMPTY = /^[\s—–-]*$/;
const LEADING_NUMBER = /^[-+]?\d[\d,]*(\.\d+)?/;

/** The cell's sort text, or undefined for an empty cell. */
function textOf(cell: Element | undefined): string | undefined {
  const raw = (cell instanceof HTMLElement && cell.dataset.sort) || cell?.textContent || "";
  const text = raw.trim();
  return EMPTY.test(text) ? undefined : text;
}

const numberOf = (text: string) =>
  Number(LEADING_NUMBER.exec(text)?.[0].replaceAll(",", "") ?? Number.NaN);

function compare(
  a: string | undefined,
  b: string | undefined,
  numeric: boolean,
  direction: 1 | -1,
): number {
  if (a === undefined || b === undefined)
    return (a === undefined ? 1 : 0) - (b === undefined ? 1 : 0);
  const order = numeric
    ? numberOf(a) - numberOf(b)
    : a.localeCompare(b, undefined, { numeric: true });
  return order * direction;
}

function enhance(table: HTMLTableElement): void {
  const body = table.tBodies[0];
  const headers = [...(table.tHead?.rows[0]?.cells ?? [])];
  if (!body) return;
  headers.forEach((header, column) => {
    if (header.dataset.nosort !== undefined) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sort-button";
    button.append(...header.childNodes);
    header.append(button);
    button.addEventListener("click", () => {
      const rows = [...body.rows].map((row) => ({ row, text: textOf(row.cells[column]) }));
      const filled = rows.flatMap(({ text }) => (text === undefined ? [] : [text]));
      const numeric = filled.length > 0 && filled.every((text) => LEADING_NUMBER.test(text));
      // First click: numbers high to low, text A to Z; then it alternates.
      const current = header.getAttribute("aria-sort");
      const ascending = current ? current === "descending" : !numeric;
      for (const other of headers) other.removeAttribute("aria-sort");
      header.setAttribute("aria-sort", ascending ? "ascending" : "descending");
      rows
        .sort((a, b) => compare(a.text, b.text, numeric, ascending ? 1 : -1))
        .forEach(({ row }) => body.append(row));
    });
  });
}

document.querySelectorAll<HTMLTableElement>("table[data-sortable]").forEach(enhance);
