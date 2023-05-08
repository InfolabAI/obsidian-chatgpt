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
import { ToAnki } from "to_anki";

export class ToAnkiForPolishUp extends ToAnki {
	testFunction1() {
		let A = "[countable noun] The highlights of an event, activity, or period of time are the most interesting or exciting parts of it."
		let B = "Option: [countable noun] The highlights of an event, activity, or period of time are the most interesting or exciting parts of it.  Explanation: The sentence suggests that the author considers the most interesting or exciting parts of events to be crucial. Therefore, the option that best represents this meaning is \"[countable noun] The highlights of an event, activity, or period of time are the most interesting or exciting parts of it.\""
		console.log(this.getDiffRegex(A, B))
	}

	testFunction2() {
		this.postfixAfterOutput("\"((Alternative solution to replace all matching tokens without using <|code|>replaceAll<|code|>)). \n`then()` is a function of the `Promise` object that can be used to assign a callback function to handle the response. Due to the distribution shift in the graph data, there is a negative impact on the performance, which necessitates the need for out-of-distribution generalization. alternative: The shift in distribution of the graph data is negatively impacting performance, hence the need for out-of-distribution generalization. `sdflkj` aslfkjsdalkfj.`")
		this.postfixAfterOutput("((Alternative)): How can I replace all matching tokens without using <|code|>replaceAll<|code|> function?")
	}

	testFunction3() {
		console.log(this.BuildAnkiFormat("How to replace all the matched tokens without `replaceAll`", "How can I replace all occurrences of a pattern without using `replaceAll`?"))
	}

	testFunction4() {
		console.log(this.replaceMatchedStringsToGetColor("`then()` is a function of the `Promise` object that can be used to assign a callback function to handle the response.", ["then()", "the", "object", "Promise"], "##cc0000"))
	}


	prefixBeforeStream(str: string): string {
		// stream 되는 text 를 md 에 쓰기 전에 수정
		str = str.replace(/`/g, "<|code|>") // Obsidian 은 " `" 를 적을 때 생략되는 문제가 있기에 다른 code 로 바꿔줌
		return str
	}

	postfixAfterOutput(str: string): string {
		// stream 이 끝난 output 을 수정(chatGPT 가 형식에 맞지 않게 답을 할 수 있기 때문)

		// additional refining
		let regex = new RegExp("(?=Alternative|Alternatives|\\(\\(Alternative\\)\\)|\\(\\(Alternatives\\)\\))(.*?)\\: (.*)", "gi") //Alternative 또는 Alternatives 가 앞에 있을 때, 뒤 match 를 시작하므로, : 이전 (.*?) 에 Alternative 또느 Alternatives 가 할당됨
		let matches = regex.exec(str)
		console.log(`\nmatches ${matches}`)
		if (matches !== null) {
			str = matches[2]
		}
		console.log(`\nafter ${str}`)

		// additional refining
		if ((/\(\(.*?\)\)/gi.exec(str) || ['a'])[0] !== str) { //(()) 를 모두 지우는데, 전체 문장이 그런게 아닐때만 지움
			str = str.replace(/\(\(.*?\)\)/gi, "")
		}
		console.log(`\nafter ${str}`)

		// additional refining
		str = str.replace(/\s-\s/gi, "")

		// additional refining
		str = str.replace("\n", " ") // 엔터 모두 없앰
		console.log(`\nafter ${str}`)

		// additional refining
		str = str.replace(/^\(\(/g, "").replace(/\)\)$/g, "")
		str = str.replace(/^\(\(\(/g, "").replace(/\)\)\)$/g, "")
		console.log(`\nafter ${str}`)

		// additional refining
		str = str.replace(/^\"|\"$/g, "")
		str = str.replace(/^\'|\'$/g, "")
		console.log(`\nafter ${str}`)

		// additional refining from prefix
		str = str.replace(/\<\|code\|\>/g, "`")

		// additional refining
		length = (str.match(/\. \w/g) || []).length //문장 간 마침표의 갯수
		console.log(length)
		if (length === 0) { // 문장 간 마침표가 없으면 마지막 마침표를 지운다(불릿에 사용될 때는 마지막 마침표 지우니까)
			str = str.replace(/\.$/g, "")
		}
		console.log(`\nafter ${str}`)

		// additional refining: 현재 ` 가 홀수이면서 맨 앞과 뒤에 ` 가 있을 때, 2개를 지우므로, 또 홀수가 되는 문제가 있어서 주석처리 함
		/*
		length = (str.match(/`/g) || []).length //exec() 는 동일한 match 는 하나만 return 하는데 match() 는 동일한 match 로 중복으로 return 해주기에 갯수를 셀 수 있음
		console.log(length)
		if (length % 2 !== 0) { // ` 의 짝이 안 맞는 경우에만 앞 뒤 ` 를 지우기 위한 식이고, (null || []) 는 [] 가 됨
			str = str.replace(/^`|`$/g, "")
		}
		console.log(`\nafter ${str}`)*/


		return str.trim()
	}

	replaceMatchedStringsToGetColor(str: string, list: string[], color: string): string {
		// 삭제되거나 추가된 주요 단어들을 highlight 하여 return

		// 짧은 단어가 그 단어를 포함하는 긴 단어에 영향을 주지 않도록, list를 역순으로 정렬하여 가장 긴 부분부터 바꾸도록 함
		list.sort((a, b) => b.length - a.length);

		// 각 요소를 순회하며 해당하는 부분을 찾아서 A로 대체
		for (let i = 0; i < list.length; i++) {
			if (list[i].trim() === "`") { // code 는 따로 처리하므로, ` 가 difference 인 경우는 제외한다
				continue
			}

			// refine
			let list_str = list[i].trim().replace(/[.*+?^${}()|[\]\\]/g, "\\\\$&") //정규식에서 사용되는 모든 기호 앞에 escape 를 붙이며, $& 는 match 된 전체 문자열을 의미하는데, 다시 문자열에 들어가므로 \\ \\ 로 두 개 붙임
			list_str = list_str.replace("`", "") // code 는 따로 처리하므로, ` 를 highlight 에서 제외한다

			console.log(`replaceMatchedStringsToGetColor > ${list_str}`)

			// 각 요소의 앞뒤 공백은 없어야 하며(trim), 앞뒤가 일반문자(a-zA-z0-9_)가 아니고(\W), string 의 맨앞 또는 뒤(^ or $) 이어야 하며, 또한 string 일때는 escape 까지 해서 \\W 로 적어야 함
			let regex_str1 = `(^${list_str})` // 시작일 때
			str = str.replace(new RegExp(regex_str1, 'g'), `<font color=${color}>$1</font>`);
			let regex_str2 = `(\`${list_str}(?!<\\/font>|\`<\\/font>)\`)` // 코드 중간이면서 한번도 font 가 바뀐 적이 없을 때 match, 즉 `문자열` 은 match 하고, `문자열`</font> 는 match 하지 않음
			str = str.replace(new RegExp(regex_str2, 'g'), `<font color=${color}>$1</font>`); // 코드인 `` 은 <font></font> 안에 와야 함. 그 이유는 <code></code> 안에 있는 모든 <> 는 &lt;&gt; 로 바꾸기 때문
			let regex_str3 = `(?!\`)(\\W)(${list_str})(?!<\\/font>|\`|\`<\\/font>)(\\W)` // 코드가 아닌 중간이면서 한번도 font 가 바뀐 적이 없을 때
			str = str.replace(new RegExp(regex_str3, 'g'), `$1<font color=${color}>$2</font>$3`); // \\W 를 <> 의 밖에 둔다는 게 포인트인데, 만약 안에 두면 \\W 가 < 또는 > 일 때, HTML 코드가 꼬이기 때문
			let regex_str4 = `(${list_str}$)`// 끝일 때
			str = str.replace(new RegExp(regex_str4, 'g'), `<font color=${color}>$1</font>`);
			console.log(`after ${str}`)
		}

		return str;
	}

	BuildAnkiFormat(question: string, answer: string) {
		// Anki 카드 format 을 만들어 return

		question = question.replace(/(\(|\))/g, "")
		answer = answer.replace(/(\(|\))/g, "")

		let [added_array, removed_array] = this.getDiffRegex(question, answer)
		question = this.replaceMatchedStringsToGetColor(question, removed_array, "#cc0000")
		answer = this.replaceMatchedStringsToGetColor(answer, added_array, "#0096ff")

		//let hint = added_array.replace("|", " / ").replace(new RegExp(added_array, "g"), "<font color=#0096ff>**$1**</font>")
		let hint = this.shuffleArray(added_array).join(" / ")
		hint = this.replaceMatchedStringsToGetColor(hint, added_array, "#0096ff")
		hint = `<br>(${hint})`

		let anki_head = question
		question += ` ${hint}`
		question = `[Polish up this in English] ${question}`

		return `- ${anki_head}%%<br>STARTI [Basic(MD)] ${question} Back: ${answer} %%` + `%% ENDI %%\n`
	}
}
