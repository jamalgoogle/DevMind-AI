const allowedOrigins = new Set(
	(process.env.ALLOWED_ORIGINS ?? '')
		.split(',')
		.map((origin) => origin.trim())
		.filter((origin) => origin.length > 0),
);

export function isAllowedOrigin(origin) {
	return typeof origin === 'string' && allowedOrigins.has(origin.trim());
}

export default isAllowedOrigin;
