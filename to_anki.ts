import {
	App,
	Editor,
	MarkdownView,
	Plugin,
	PluginSettingTab,
	Setting,
	requestUrl,
	TFile,
	Notice,
	SuggestModal,
	TFolder,
	Platform,
} from "obsidian";

export class ToAnki {

	removeHtmlTags(str: string): string {
		// str 내 모든 HTML tags 제거
		return str.replace(/<[^>]+>/g, '');
	}

	zip<T, U>(array1: T[], array2: U[]): [T, U][] {
		// 두 배열을 더 짧은 배열의 끝까지 각각 하나씩 추출
		const length = Math.min(array1.length, array2.length);
		return Array.from({ length }, (_, index) => [array1[index], array2[index]]);
	}

	shuffleArray<T>(arr: T[]): T[] {
		// array 요소를 섞은 후 return
		for (let i = arr.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[arr[i], arr[j]] = [arr[j], arr[i]];
		}
		return arr;
	}

	getDiffRegex(a: string, b: string): [string[], string[]] {
		// 내 문장과 chatGPT 문장의 차이점을 return
		const diff = require('diff');
		const diffResult = diff.diffWordsWithSpace(a, b);
		let result = '';
		let added_array: string[] = []
		let removed_array: string[] = []
		diffResult.forEach((part: any) => {
			if (part.added && part.value.match(/\w/g) !== null) { // 기호만 있는 경우는 highlight 할 의미가 없으므로 제외한다
				added_array = [...added_array, part.value]
			} else if (part.removed && part.value.match(/\w/g) !== null) { // 기호만 있는 경우는 highlight 할 의미가 없으므로 제외한다
				removed_array = [...removed_array, part.value]
			} else {
			}
		});
		return [added_array, removed_array]
	}

	openFileByPath(filePath: string): TFile {
		// 경로의 md 파일 open
		const file = app.vault.getAbstractFileByPath(filePath) as TFile;
		if (file === null) {
			new Notice(`There is no file at path ${filePath}. You need to create the file first.`);
			throw new Error(`There is no file at path ${filePath}. You need to create the file first.`);
		}

		return file;
	}

	appendToNote(file: TFile, content: string): void {
		// md 파일 뒤에 내용 추가
		const currentContent = app.vault.append(file, content);
		//const newContent = `${content}\n${currentContent}`;
		//app.vault.modify(file, newContent);
	}

}
