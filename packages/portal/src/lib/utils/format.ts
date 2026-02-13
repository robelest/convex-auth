/**
 * Format a Convex _creationTime (ms since epoch) to a human-readable date.
 */
export function formatDate(ms: number): string {
	return new Date(ms).toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
	});
}

/**
 * Format a Convex _creationTime to a date + time string.
 */
export function formatDateTime(ms: number): string {
	return new Date(ms).toLocaleString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	});
}

/**
 * Format a relative time string (e.g. "2 hours ago", "in 3 days").
 */
export function formatRelative(ms: number): string {
	const now = Date.now();
	const diff = now - ms;
	const absDiff = Math.abs(diff);
	const past = diff > 0;

	const seconds = Math.floor(absDiff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	let label: string;
	if (days > 30) {
		label = formatDate(ms);
		return label;
	} else if (days > 0) {
		label = `${days}d`;
	} else if (hours > 0) {
		label = `${hours}h`;
	} else if (minutes > 0) {
		label = `${minutes}m`;
	} else {
		label = 'just now';
		return label;
	}

	return past ? `${label} ago` : `in ${label}`;
}

/**
 * Truncate a Convex document ID for display (first 8 chars).
 */
export function truncateId(id: string): string {
	if (id.length <= 12) return id;
	return id.slice(0, 8) + '...';
}

/**
 * Check if a session is expired.
 */
export function isSessionExpired(expirationTime: number): boolean {
	return Date.now() > expirationTime;
}
