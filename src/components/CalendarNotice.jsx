/**
 * One line at the top of the map when calendar invites need the rep's
 * attention: the planner calendar couldn't be read, or an invited visit has
 * no address the map can find. Silent otherwise.
 */
export default function CalendarNotice({ error = '', unplaced = [] }) {
  if (error) {
    return (
      <div className="banner banner-muted banner-wrap" role="status">
        {error}
      </div>
    );
  }
  if (unplaced.length === 0) return null;

  const names = unplaced.slice(0, 2).map((u) => u.name).join(', ');
  const more = unplaced.length > 2 ? ` and ${unplaced.length - 2} more` : '';
  const what =
    unplaced.length === 1 ? 'A calendar visit' : `${unplaced.length} calendar visits`;

  // A lookup that failed is OneMap having a bad moment, not the rep's doing.
  const onlyLookupTrouble = unplaced.every((u) => u.reason === 'lookup-failed');
  const fix = onlyLookupTrouble
    ? 'The address lookup will try again shortly.'
    : "Add the postal code to the event's title or Location.";

  return (
    <div className="banner banner-warn banner-wrap" role="status">
      {what} couldn&rsquo;t be placed: {names}
      {more}. {fix}
    </div>
  );
}
