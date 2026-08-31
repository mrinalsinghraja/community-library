import {
  AGE_GROUPS,
  CONDITIONS,
  STATUSES,
} from "@/lib/catalogue";
import type { BookFilter } from "@/lib/book-filter";

/**
 * The controls that narrow a shelf, drawn once.
 *
 * Both screens that choose books from the catalogue use this: the book list and
 * the label sheet. They must offer the same questions, because the promise
 * behind the Print labels button is that the sheet is the list you were looking
 * at — and a filter that exists on one screen and not the other quietly breaks
 * that promise for whoever prints from the wrong page.
 *
 * Plain form fields with no state and no client component. Everything lives in
 * the query string, so the count is worked out on the server, the screens work
 * with JavaScript switched off, and a librarian can bookmark "everything the
 * Nairs gave, comics, 8–11" and come back to it.
 *
 * The five common questions sit in the bar. The other six — a book ID range,
 * the donor, the flat, and the two date ranges — sit behind a disclosure,
 * opened when any of them is in use, because a bar of eleven controls is a form
 * nobody reads and these are the ones asked once a month.
 */

export function BookFilterFields({
  filter,
  categories,
}: {
  filter: BookFilter;
  categories: { id: string; name: string }[];
}) {
  const narrowed = Boolean(
    filter.codeFrom ||
      filter.codeTo ||
      filter.donorName ||
      filter.donorFlat ||
      filter.donatedFrom ||
      filter.donatedTo ||
      filter.addedFrom ||
      filter.addedTo,
  );

  return (
    <>
      <label className="flex flex-col gap-1 sm:col-span-2">
        <span className="text-sm font-semibold text-ink-soft">Search</span>
        <input
          type="search"
          name="q"
          defaultValue={filter.search}
          placeholder="Title, author/publisher or ID"
          className="min-h-10 w-full rounded-[var(--radius-field)] border border-control-border bg-surface px-3 text-base"
        />
      </label>

      <FilterSelect label="Shelf" name="category" value={filter.categoryId}>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </FilterSelect>

      <FilterSelect label="Age" name="age" value={filter.ageGroup}>
        {AGE_GROUPS.map((group) => (
          <option key={group.value} value={group.value}>
            {group.label}
          </option>
        ))}
      </FilterSelect>

      <FilterSelect label="Condition" name="condition" value={filter.condition}>
        {CONDITIONS.map((condition) => (
          <option key={condition.value} value={condition.value}>
            {condition.label}
          </option>
        ))}
      </FilterSelect>

      <FilterSelect label="Status" name="status" value={filter.status}>
        {STATUSES.map((entry) => (
          <option key={entry.value} value={entry.value}>
            {entry.staffLabel}
          </option>
        ))}
      </FilterSelect>

      <details
        open={narrowed}
        className="col-span-full rounded-[var(--radius-field)] border border-control-border bg-surface px-4 py-3"
      >
        <summary className="cursor-pointer text-sm font-semibold text-ink">
          More ways to narrow
          <span className="ml-2 font-normal text-ink-soft">
            book ID range, donor, donation dates
          </span>
        </summary>

        <div className="mt-4 grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <FilterText
            label="Book ID from"
            name="codeFrom"
            value={filter.codeFrom}
            placeholder="e.g. 1"
          />
          <FilterText
            label="Book ID to"
            name="codeTo"
            value={filter.codeTo}
            placeholder="e.g. 20"
          />

          <FilterText label="Donor name" name="donor" value={filter.donorName} />
          <FilterText label="Donor flat" name="flat" value={filter.donorFlat} />

          <FilterText label="Donated from" name="donatedFrom" value={filter.donatedFrom} type="date" />
          <FilterText label="Donated up to" name="donatedTo" value={filter.donatedTo} type="date" />

          <FilterText label="Added from" name="addedFrom" value={filter.addedFrom} type="date" />
          <FilterText label="Added up to" name="addedTo" value={filter.addedTo} type="date" />
        </div>

        <p className="mt-3 text-sm text-ink-soft">
          A book ID range takes the numbers on the books — 1 to 20 means the
          first twenty. Dates include both ends, so the same date twice means
          that one day. The donor questions look only at books that were given.
        </p>
      </details>

      <label className="flex items-center gap-2.5 self-end pb-1.5">
        <input
          type="checkbox"
          name="archived"
          value="1"
          defaultChecked={filter.includeArchived}
          className="size-6 rounded border-2 border-control-border"
        />
        <span className="text-sm font-semibold text-ink">Include archived</span>
      </label>
    </>
  );
}

/** A labelled filter dropdown with an "any" option, unless it is a sort control. */
export function FilterSelect({
  label,
  name,
  value,
  includeAny = true,
  children,
}: {
  label: string;
  name: string;
  value: string;
  includeAny?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold text-ink-soft">{label}</span>
      <select
        name={name}
        defaultValue={value}
        className="min-h-10 w-full rounded-[var(--radius-field)] border border-control-border bg-surface px-2.5 text-base"
      >
        {includeAny ? <option value="">Any</option> : null}
        {children}
      </select>
    </label>
  );
}

function FilterText({
  label,
  name,
  value,
  type = "text",
  placeholder,
}: {
  label: string;
  name: string;
  value: string;
  type?: "text" | "date";
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold text-ink-soft">{label}</span>
      <input
        type={type}
        name={name}
        defaultValue={value}
        placeholder={placeholder}
        autoComplete="off"
        className="min-h-10 w-full rounded-[var(--radius-field)] border border-control-border bg-surface px-3 text-base"
      />
    </label>
  );
}
