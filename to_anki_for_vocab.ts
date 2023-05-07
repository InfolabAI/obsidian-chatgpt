
/* eslint-disable @typescript-eslint/no-var-requires */
import axios from 'axios';
import cheerio from 'cheerio';
import { logWithLocation, waitForVariable } from 'utils';
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
import { ToAnki } from 'to_anki';

interface Word { // 이것을 객체로 만들어야 하는게 아니라, SuggestModal 에게 이런 형태를 처리하라는 약속을 보내는 것 뿐임
	word_str: string
}
const KEEP_GOING: string = "KEEP GOING WITH CURRENT WORD "
const QUIT: string = "QUIT THIS COMMAND"

export class SuggestWords extends SuggestModal<Word> {
	words: Word[] = []
	selected_word: Word = {
		word_str: ""
	}

	constructor(app: App, strings: string[]) {
		super(app);
		if (strings.length === 0) {

		}
		this.words.push({
			word_str: QUIT
		})
		for (let str of strings) {
			this.words.push({
				word_str: str
			})
		}
	}

	getSuggestions(query: string): Word[] | Promise<Word[]> {
		return this.words
	}

	renderSuggestion(value: Word, el: HTMLElement) {
		el.createEl("div", { text: value.word_str })
		logWithLocation(value.word_str)
	}

	onChooseSuggestion(item: Word, evt: MouseEvent | KeyboardEvent) { // onChooseSuggestion 은 기본적으로 또 다른 thread 롤 돌아가므로, main thread 를 멈추는 waitForVariable 함수가 필요함
		new Notice(`Selected ${item.word_str}`);
		this.selected_word.word_str = item.word_str
	}
}

export class ToAnkiForVocab extends ToAnki {
	editor: Editor
	definition_array: string[] = []
	selected_word: string = ""
	searched_word: string = ""
	num_definitions: number = 0
	pre_selection_format: string = "((("
	post_selection_format: string = ")))"

	constructor(editor: Editor, selected_word: string) {
		super()
		if (!selected_word) {
			new Notice("Nothing is selected")
			throw new Error("Nothing is selected")
		}

		this.editor = editor
		this.selected_word = selected_word
		this.searched_word = selected_word
	}

	testFunction1() {
		logWithLocation(this.getDefinitionsOfCollins("gi through"))
	}

	testFunction2() { // 커서 위치 주변 정보 출력 함수
		this.getSentencesAroundSelection()
	}

	getMostSimilarDefinitions(answerFromChatGPT: string): string {
		// definition 이 많으면 Anki card 가 지저분해지는 문제가 있으므로, chatGPT 의 대답과 가장 유사한 definition 3개를 골라 return
		let counts: Record<string, number> = {}
		for (let [i, def] of this.definition_array.entries()) {
			let arr = this.getDiffRegex(def, answerFromChatGPT)
			let el_count = 0
			for (const innerArr of arr) {
				for (const elem of innerArr) {
					if (typeof elem === "string") {
						el_count++
					}
				}
			}
			counts[i.toString()] = el_count
		}

		let top_definitions: string = ""
		let top_definitions_array: string[] = []
		for (let key of this.getTopThreeKeys(counts)) {
			top_definitions_array.push(`${this.definition_array[Number(key)]}\n`)
		}
		let shuffled_array = this.shuffleArray(top_definitions_array)
		for (let def of shuffled_array) {
			top_definitions += def
		}
		return top_definitions
	}

	getTopThreeKeys(obj: Record<string, number>): string[] {
		// object 내에서 value 가 가장 "낮은" 순서대로 top 3 key 를 추출하여 return
		const sortedKeys = Object.keys(obj).sort((a, b) => obj[a] - obj[b]);
		return sortedKeys.slice(0, 3);
	}


	postfixAfterOutput(str: string) {

	}

	async buildQuestionToChatGPT(): Promise<string[]> {
		// ChatGPT 에 넘길 내용들을 생성해서 return

		let sentence = this.getSentencesAroundSelection()
		let definitions = await this.getDefinitionsOfCollins()

		return [sentence, definitions]
	}

	getSentencesAroundSelection(): string {
		// selection 은 단어만이니까, context 파악을 위해서 그 주변 정보를 추출해서 return

		const content = this.editor.getValue();
		logWithLocation(content)
		const cursorPos = this.editor.getCursor(); // 현재 커서 위치 정보
		logWithLocation(cursorPos)
		let rowContent = this.editor.getLine(cursorPos.line); // 현재 행(row) 내용이고, 아직 문장은 아니며, 예를 들어 table 의 한 행일 수 있음
		logWithLocation(rowContent) // 현재는 table 등까지 고려하는 문장 선택 regex 가 어려워서 row 단위로 content 를 사용함

		// postprocess
		const cursorPos_from = this.editor.getCursor('from'); // 현재 커서에서 selection 의 처음으로 이동시킨 후의 위치 정보
		const cursorPos_to = this.editor.getCursor('to'); // 현재 커서에서 selection 의 끝으로 이동시킨 후의 위치 정보
		rowContent = rowContent.slice(0, cursorPos_from.ch)
			+ this.pre_selection_format
			+ this.selected_word
			+ this.post_selection_format
			+ rowContent.slice(cursorPos_to.ch)
		logWithLocation(rowContent)

		return rowContent

	}

	BuildAnkiFormat(question: string, answer: string) {
		// Anki 카드 format 을 만들어 return
		let additional_term = ""
		if (this.selected_word !== this.searched_word) {
			additional_term = `(Searched by <font color=#cc0000>${this.searched_word}</font>)`
		}

		question = question.replace(/\(\(\((.*?)\)\)\)/g, `<font color=#0096ff>**$1**</font>${additional_term}`)

		question = `<font color="green">**[Predict the definition of highlighted text]**</font>\n${question}`

		//postprocessing to HTML
		question = question.replace(/\n/g, "<br>")
		answer = answer.replace(/\n/g, "<br>")
		question = question.replace(/(\[Random.*?options\])/g, `<font color="green">**$1**</font>`)
		question = question.replace(/\<br\>(\d+\.\s+\[.*?\])/g, `<br><font color=#c0c0c0>$1</font>`)
		return `- ${this.selected_word}${additional_term}^[%%<br>STARTI [Basic(MD)] ${question} Back: ${answer} %%` + `%% ENDI %%]\n`
	}

	async getDefinitionsOfCollins(phrase: string = this.selected_word): Promise<string> {
		// 검색할 단어로 url 만드는 것 외에 definition 은 하위 함수로 추출하고 return

		this.num_definitions = 0

		phrase = phrase.toLowerCase().replace(/\s/g, "-") // URL 에 대문자가 들어가면 에러 발생하므로, 모두 소문자로 바꾸고, 스페이스는 - 로 바꾸는데 이것은 Collins page 의 규칙을 따라함
		let url = 'https://www.collinsdictionary.com/dictionary/english/' + phrase
		new Notice(url)
		let ret = ""
		await this.extractDefinitions(url).then((response: string) => {
			ret = response
		})
		return ret
	}

	getSuggestedWords($: any): string[] {
		// HTML 내에서 suggest word 를 return하는데, page 자체가 업는 경우와, Collins definition 만 없는 경우를 다룸

		// Page 는 있는데 Collins 의미는 없고, British 등 다른 의미만 있는 page 인 경우
		let selectedBlock: any = null
		$('.columns2 .columns-block').each((_: any, el: any) => { // 각 .columns-block 요소마다 하위의 h2.entry-title 요소의 text() 를 확인
			const h2 = $(el).find('.cB-h h2.entry_title');
			if (h2.contents().filter(function () { return this.type === "text" }).text().trim() === "Related terms of") {//h2 의 모든 자식요소(contents()) 중 type이 "text" 인 것에 대해서만 .text() 함수를 적용함 (그 하위 자식 요소의 text 는 제외하기 위한 filter)
				selectedBlock = $(el);
				return false; // break
			}
		});
		let suggestedWords = $(selectedBlock).find('ul li') // 찾은 .columns-block 내부의 요소에서 text 를 추출
			.toArray()
			.map((li: any) => {
				logWithLocation($(li))
				let suggested = $(li).find('a').text().trim()
				if (suggested !== "View more related words") {
					return suggested
				}
			});

		// 아예 page 가 없는 경우
		let not_supported_word_page_elements = $('.suggested_words .columns2 li').toArray()
		if (not_supported_word_page_elements.length !== 0) {
			suggestedWords = not_supported_word_page_elements
				.map((li: any) => $(li).text().trim());
		} else {
			suggestedWords = [KEEP_GOING + this.searched_word, ...suggestedWords]
		}

		return suggestedWords;
	}

	async extractDefinitions(url: string): Promise<string> {
		// url 을 이용해서 HTML 내 definitions 를 return 하는데, 단어 page 가 없거나, Collins definition 이 없으면 다른 단어를 이용하도록 suggest 

		const response = await axios.get(url);
		const html = response.data;
		const $ = cheerio.load(html);
		if ($('div[data-type-block="definition.title.type.cobuild"]').length === 0) { // 해당 단어 정보가 없을 경우 공지
			new Notice('There is no definition of given url');
		}
		// suggestion 중에 하나를 골라 그 정보를 이용함
		let suggestWord = new SuggestWords(app, this.getSuggestedWords($))
		suggestWord.open()
		await waitForVariable(() => suggestWord.selected_word.word_str, "")
		if (suggestWord.selected_word.word_str == KEEP_GOING + this.searched_word) {
		} else if (suggestWord.selected_word.word_str == QUIT) {
			throw new Error('QUIT by USER')
		} else {
			this.searched_word = suggestWord.selected_word.word_str // selected_word 변경
			return this.getDefinitionsOfCollins(suggestWord.selected_word.word_str) // 상위 함수로 재귀
		}

		// 해당 단어 정보를 찾는데 성공함

		//get difinitions
		const definitions: string[] = [];
		$('div[data-type-block="definition.title.type.cobuild"] div.hom').each((_: any, el: any) => { // hom 마다 돌면서 hom 내 첫 번째 div.def 의 text 만 가져옴(hom 내에 여러 개의 div.def 가 있을 수 있기 때문)
			const h2 = $(el).find('div.def').first();
			const def = this.removeHtmlTags(h2.text().trim())
			if (def !== "") {
				definitions.push(def)
			}
		});
		logWithLocation(definitions)

		//get etc
		const gramGrps: string[] = [];
		$('div[data-type-block="definition.title.type.cobuild"] div.hom').each((index, element) => {
			const homHtml = $(element).html();
			if (homHtml !== null) {
				let gramGrp = this.extractGramPos(homHtml);
				gramGrp = this.removeHtmlTags(gramGrp)
				gramGrps.push(gramGrp);
			}
		});

		let ret = ''
		for (let [i, [g, d]] of this.zip(gramGrps, definitions).entries()) {
			//ret += `<font color=#0096ff>[${g}]</font> ${d}<br>`
			let def = `${i + 1}. [${g}] ${d.replace(/\n/g, "")}\n`
			ret += def
			this.definition_array.push(def)
			this.num_definitions++
		}
		if (ret === '') {
			throw Error(`ToAnkiforVocab > extractDefinitions() > no definition is gathered.`)
		}
		logWithLocation(ret);
		return ret
	}

	extractGramPos(html: string): string {
		// HTML 요소 추척해서 return

		const $ = cheerio.load(html);
		const a = $('span.gramGrp span.pos').first().text().trim();
		const b = $('span.gramGrp.pos').first().text().trim();
		if (a !== "") {
			return a
		}
		else {
			return b
		}
	}



}
