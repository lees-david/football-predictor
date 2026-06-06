export const getUserTimezone = (): string => {
  const saved = localStorage.getItem('userTimezone');
  return saved || Intl.DateTimeFormat().resolvedOptions().timeZone;
};

export const formatDateTime = (
  dateInput: string | Date | number,
  options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }
): string => {
  const date = new Date(dateInput);
  const timezone = getUserTimezone();
  try {
    return date.toLocaleString(undefined, {
      ...options,
      timeZone: timezone
    });
  } catch (e) {
    console.error("Invalid timezone format:", timezone, e);
    return date.toLocaleString(undefined, options);
  }
};

export const COMMON_TIMEZONES = [
  { value: 'UTC', label: 'UTC / GMT (Coordinated Universal Time)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Paris / Berlin / Madrid (CET/CEST)' },
  { value: 'Europe/Athens', label: 'Athens / Istanbul (EET/EEST)' },
  { value: 'America/New_York', label: 'New York / Toronto (EST/EDT)' },
  { value: 'America/Chicago', label: 'Chicago / Dallas (CST/CDT)' },
  { value: 'America/Denver', label: 'Denver / Salt Lake City (MST/MDT)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles / Vancouver (PST/PDT)' },
  { value: 'America/Sao_Paulo', label: 'São Paulo (BRT)' },
  { value: 'Asia/Dubai', label: 'Dubai (GST)' },
  { value: 'Asia/Kolkata', label: 'India (IST)' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
  { value: 'Asia/Tokyo', label: 'Tokyo / Seoul (JST)' },
  { value: 'Australia/Sydney', label: 'Sydney / Melbourne (AEST/AEDT)' },
];
