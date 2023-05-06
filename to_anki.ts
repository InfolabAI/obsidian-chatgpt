/* eslint-disable @typescript-eslint/no-var-requires */
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

	getDiffRegex(a: string, b: string): [string[], string[]] {
		const diff = require('diff');
		const diffResult = diff.diffWordsWithSpace(a, b);
		let result = '';
		let added_array: string[] = []
		let removed_array: string[] = []
		diffResult.forEach(part => {
			if (part.added) {
				added_array = [...added_array, part.value]
			} else if (part.removed) {
				removed_array = [...removed_array, part.value]
			} else {
			}
		});
		return [added_array, removed_array]
	}

	shuffleArray<T>(arr: T[]): T[] {
		for (let i = arr.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[arr[i], arr[j]] = [arr[j], arr[i]];
		}
		return arr;
	}

	replaceMatchedStringsToGetColor(str: string, list: string[], color: string): string {
		// 짧은 단어가 그 단어를 포함하는 긴 단어에 영향을 주지 않도록, list를 역순으로 정렬하여 가장 긴 부분부터 바꾸도록 함
		list.sort((a, b) => b.length - a.length);

		// 각 요소를 순회하며 해당하는 부분을 찾아서 A로 대체
		for (let i = 0; i < list.length; i++) {
			// 각 요소의 앞뒤 공백은 없어야 하며(trim), 앞뒤가 일반문자(a-zA-z0-9_)가 아니고(\W), string 의 맨앞 또는 뒤(^ or $) 이어야 하며, 또한 string 일때는 escape 까지 해서 \\W 로 적어야 함
			let regex_str1 = `(^${list[i].trim()})` // 시작일 때
			str = str.replace(new RegExp(regex_str1, 'g'), `<font color=${color}>$1</font>`);
			let regex_str2 = `(\\W)(${list[i].trim()})(\\W)` // 중간일 때
			str = str.replace(new RegExp(regex_str2, 'g'), `$1<font color=${color}>$2</font>$3`); // \\W 를 <> 의 밖에 둔다는 게 포인트인데, 만약 안에 두면 \\W 가 < 또는 > 일 때, HTML 코드가 꼬이기 때문
			let regex_str3 = `(${list[i].trim()}$)`// 끝일 때
			str = str.replace(new RegExp(regex_str3, 'g'), `<font color=${color}>$1</font>`);
			console.log(`after ${str}`)
		}

		return str;
	}


	BuildAnkiFormat(question: string, answer: string) {
		question = question.replace(/(\(|\))/g, "")
		answer = answer.replace(/(\(|\))/g, "")

		let [added_array, removed_array] = this.getDiffRegex(question, answer)
		question = this.replaceMatchedStringsToGetColor(question, removed_array, "#cc0000")
		answer = this.replaceMatchedStringsToGetColor(answer, added_array, "#0096ff")

		//let hint = added_array.replace("|", " / ").replace(new RegExp(added_array, "g"), "<font color=#0096ff>**$1**</font>")
		let hint = this.shuffleArray(added_array).join(" / ")
		hint = this.replaceMatchedStringsToGetColor(hint, added_array, "#0096ff")
		hint = `<br>(${hint})`

		question += ` ${hint}`
		question = `[Polish up this in English] ${question}`

		return `%%<br>STARTI [Basic(MD)] ${question} Back: ${answer} %%` + `%% ENDI %%\n`
	}

	openFileByPath(filePath: string): TFile {
		const file = app.vault.getAbstractFileByPath(filePath) as TFile;
		if (file === null) {
			new Notice(`There is no file at path ${filePath}. You need to create the file first.`);
			throw new Error(`There is no file at path ${filePath}. You need to create the file first.`);
		}

		return file;
	}
	appendToNote(file: TFile, content: string): void {
		const currentContent = app.vault.append(file, content);
		//const newContent = `${content}\n${currentContent}`;
		//app.vault.modify(file, newContent);
	}
}
