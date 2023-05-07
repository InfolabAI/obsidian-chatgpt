export function logWithLocation(message: any) {
	const stackTrace = (new Error().stack || '').split('\n');
	const caller = stackTrace[2] || '';
	const functionName = caller
		.trim()
		.replace(/^at /, '')
		.replace(/\(.+\)$/, '')
		.split(' ')[1];
	const className = caller.match(/at\s+(.+?)\./);
	const location = className ? `${className[1]} > ${functionName} > ` : `${functionName} > `;
	console.log(`${new Date().toISOString()} ${location}${message}`);
}
