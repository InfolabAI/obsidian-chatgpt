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

	getDiffRegex(a: string, b: string): string[] {
		const diff = require('diff');
		const diffResult = diff.diffWordsWithSpace(a, b);
		let result = '';
		let added_regex = "("
		let removed_regex = "("
		diffResult.forEach(part => {
			if (part.added) {
				added_regex += `${part.value}|`
			} else if (part.removed) {
				removed_regex += `${part.value}|`
			} else {
			}
		});
		added_regex = added_regex.replace(/\|$/, ")")
		removed_regex = removed_regex.replace(/\|$/, ")")
		return [added_regex, removed_regex];
	}

	shuffleArray<T>(arr: T[]): T[] {
		for (let i = arr.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[arr[i], arr[j]] = [arr[j], arr[i]];
		}
		return arr;
	}


	BuildAnkiFormat(question: string, answer: string) {
		question = question.replace(/(\(\))/g, "")
		answer = answer.replace(/(\(\))/g, "")

		let [added_regex, removed_regex] = this.getDiffRegex(question, answer)
		question = question.replace(new RegExp(removed_regex, "g"), "<font color=#cc0000>**$1**</font>")

		//let hint = added_regex.replace("|", " / ").replace(new RegExp(added_regex, "g"), "<font color=#0096ff>**$1**</font>")
		let hint_array = added_regex.replace(/(\(|\))/g, "").split("|")
		let hint = this.shuffleArray(hint_array).join(" / ").replace(new RegExp(added_regex, "g"), "<font color=#0096ff>**$1**</font>")
		hint = `<br>(${hint})`

		question += ` ${hint}`
		answer = answer.replace(new RegExp(added_regex, "g"), "<font color=#0096ff>**$1**</font>")
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
