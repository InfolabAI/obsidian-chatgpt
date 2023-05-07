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

export async function waitForVariable<T>( // variable 이 initialValue 가 아닐 때까지 기다리는 함수이며, 비동기 프로그램이라서 SuggestModal 과 같은 new thread 의 종료를 기다릴 필요가 있을 때 사용
	variable: () => T,
	initialValue: T,
	intervalTime: number = 1000
): Promise<void> {
	return new Promise<void>((resolve) => {
		const intervalId = setInterval(() => {
			if (variable() !== initialValue) {
				clearInterval(intervalId);
				resolve();
			}
		}, intervalTime);
	});
}
