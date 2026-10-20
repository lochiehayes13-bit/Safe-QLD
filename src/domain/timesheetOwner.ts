/**
 * Whose timesheet this phone fills in: the name that goes on every week, and
 * the vehicle a new week starts with.
 *
 * Accounts asked for every sheet to carry its owner's name, for an audit. A
 * week was only named if the name had been set in Settings before the week
 * was started, so a week begun on a phone set up later stayed blank, and
 * Export and the page went out blank too. The name comes from Settings, else
 * from the person picked in Simpro, so long as they are still on the staff.
 *
 * Only the name is filled into weeks that already exist, and only drafts: a
 * vehicle is a claim about that week, and a submitted week stays as it was
 * sent.
 */
export interface TimesheetOwner {
  name: string;
  vehicleRego: string;
}

export function timesheetOwner(
  prefs: { technicianName: string; vehicleRego: string },
  employee?: { name: string; archived?: boolean } | null,
): TimesheetOwner {
  const picked = employee && !employee.archived ? employee.name.trim() : '';
  return {
    name: prefs.technicianName.trim() || picked,
    vehicleRego: prefs.vehicleRego.trim(),
  };
}

/** What stops a sheet leaving the phone by any route: no name on it. */
export const NO_NAME_ON_SHEET = 'Type your name in the Name box, or set it in Settings.';
