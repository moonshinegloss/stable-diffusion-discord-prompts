// ==UserScript==
// @name         png metadata discord
// @author       moonshine
// @version      2.6
// @updateURL    https://raw.githubusercontent.com/moonshinegloss/stable-diffusion-discord-prompts/main/discord-prompt.user.js
// @match        https://discord.com/channels/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=discord.com
// @grant        GM.xmlHttpRequest
// @grant        GM_addStyle
// ==/UserScript==

const ignoreDMs = true;

function largeuint8ArrToString(uint8arr) {
    return new Promise((resolve) => {
        const f = new FileReader();
        f.onload = function(e) {
            resolve(e.target.result);
        }
        f.readAsText(new Blob([uint8arr]));
    })
}

async function getMetaData(chunks) {
    const meta = readMetadata(chunks)
    if(meta?.tEXt?.Dream) {
        return `${meta?.tEXt?.Dream} ${meta?.tEXt?.['sd-metadata'] || ''}`
    }else if(meta?.tEXt?.parameters) {
        return meta?.tEXt?.parameters
    }

    // fallback to simple text extraction
    const textData = await largeuint8ArrToString(chunks)
    const textTypes = ["Dream","parameters"]

    if(textData.includes("IDAT") && textTypes.some(x => textData.includes(x))) {
        const result = textData.split("IDAT")[0]
            .replace(new RegExp(`[\\s\\S]+Xt(${textTypes.join('|')})`),"")
            .replace(/[^\x00-\x7F]/g,"")

        if(result.length > 50) return result
    }

    return false;
}

async function addRevealPrompt(chunks,node) {
    try {
        const container_selector = node.closest("div[class*='messageAttachment-']")
        const params = await getMetaData(chunks);

        // ignore images that have been processed already
        if(params && !container_selector.className.includes("prompt-preview-container")) {
            // style the image preview, while preserving discord click events for spoilers/lightbox
            node.classList.add("prompt-preview");

            container_selector.classList.add("prompt-preview-container");
            container_selector.style.flexDirection = "column";

            const revealPrompt = document.createElement("div");
            revealPrompt.innerHTML = `
                                  <details style="color:white">
                                    <summary class="promptBTN">Reveal Prompt</summary>
                                    <div class="promptTXT"><p style="margin:5px">${params}</p></div>
                                  </details>
                            `

            container_selector.prepend(revealPrompt);
        }
    }catch(err){
        console.log(err)
    }
}

async function processURL(url,node) {
    return new Promise(async (finish) => {
        const chunks = await new Promise(function(resolve){
            let chunks = [];
            let received = 0;
            const req = GM.xmlHttpRequest({
                method: "GET",
                url,
                responseType: "stream",
                onloadstart: async (r) => {
                    const reader = r.response.getReader();

                    // process up to 2MB, to capture even large prompts
                    const kilobytes = 2000
                    while(received < kilobytes*1000) {
                        const {done, value} = await reader.read();
                        if (done) break;
                        chunks.push(value);
                        received += value.length;
                    }

                    resolve(chunks)
                    await reader.cancel();
                    await req.abort()
                }
            });
        })

        if(chunks.length > 0) {
            await addRevealPrompt(chunks[0],node);
        }

        node.classList.remove("prompt-preview-processing");
        finish();
    })
}

function validURL(source) {
    return !!source && source.includes(".png") && (source.includes("media.discordapp.net") || source.includes("cdn.discordapp.com")) && source.includes("attachments");
}

async function refreshImages(nodes) {
    nodes = nodes || document.querySelectorAll("div[class*='imageWrapper-'], div[class*='spoilerContainer-']")
    let queue = []
    const workers = 4

    for(let i = nodes.length-1; i >= 0; i--) {
        const source = nodes?.[i]?.querySelector("img")?.src
        if(!validURL(source)) continue;

        nodes[i].classList.add("prompt-preview-processing");

        queue.push(() => {
            const url = source.replace("media.discordapp.net","cdn.discordapp.com")
            processURL(url,nodes[i]);
        })
    }

    while (queue.length) {
        await Promise.all(queue.splice(0, workers).map(f => f()))
    }
}

async function hook() {
    const observableSelector = "main[class*='chatContent-']"
    while(!document.querySelector(observableSelector)) {
        await new Promise(r => setTimeout(r, 200));
    }

    let observer = new MutationObserver(mutationRecords => {
        const images = [...new Set(mutationRecords.filter(x => {
            const source = x?.target?.firstChild?.src
            return validURL(source);
        }).map(x => x?.target?.firstChild.closest("div[class*='imageWrapper-'], div[class*='spoilerContainer-']")))];

        if(images.length == 0) return;
        refreshImages(images)
    });

    // note the lack of .disconnect(); that's on purpose because the spec
    // already garbage-collects the observer if the observable node is deleted
    // further triggering an .observe() on the same item is a NOOP
    observer.observe(document.querySelector(observableSelector), {
        childList: true, // observe direct children
        subtree: true, // and lower descendants too
        characterDataOldValue: true // pass old data to callback
    });
}



(async function() {
    'use strict';

    const borderColor = "rgba(88, 101, 242, 0.35)";
    const loadingColor = "rgba(255,255,0,0.35)";
    GM_addStyle(`
          /* thanks to archon */
          details[open] + div{
            border-top: 0 !important;
            border-top-right-radius: 0 !important;
          }

          .promptTXT {
            border: 3px solid ${borderColor};
          }

          .prompt-preview-processing {
            border: 3px solid ${loadingColor};
            border-radius:7px;
          }

          .promptBTN {
            cursor: pointer;
            list-style: none;
            background:${borderColor};
            border-top-left-radius: 5px;
            border-top-right-radius: 5px;
            padding:5px;
            margin-top:.25rem;
          }

          .prompt-preview {
            border: 3px solid ${borderColor};
            border-radius:7px;
            border-top-left-radius:0;
          }
    `);

    new MutationObserver(function(mutations) {
        // ignore DMs for privacy sake by default
        if(ignoreDMs && window.location.href.includes("@me")) return;

        // refresh existing images that will not trigger change
        refreshImages();

        // hook into oncoming new images being added to chat
        hook();
    }).observe(
        document.querySelector('title'),
        { subtree: true, characterData: true, childList: true }
    );
})();


// Used for fast-ish conversion between uint8s and uint32s/int32s.
// Also required in order to remain agnostic for both Node Buffers and
// Uint8Arrays.
let uint8 = new Uint8Array(4)
let int32 = new Int32Array(uint8.buffer)
let uint32 = new Uint32Array(uint8.buffer)

const RESOLUTION_UNITS = {UNDEFINED: 0, METERS: 1, INCHES: 2};

/**
 * https://github.com/hughsk/png-chunk-text
 * Reads a Uint8Array or Node.js Buffer instance containing a tEXt PNG chunk's data and returns its keyword/text:
 * @param data
 * @returns {{text: string, keyword: string}}
 */
function textDecode (data) {
	if (data.data && data.name) {
		data = data.data
	}

	let naming = true
	let text = ''
	let name = ''

	for (let i = 0; i < data.length; i++) {
		let code = data[i]

		if (naming) {
			if (code) {
				name += String.fromCharCode(code)
			} else {
				naming = false
			}
		} else {
			if (code) {
				text += String.fromCharCode(code)
			}
		}
	}

	return {
		keyword: name,
		text: text
	}
}

/**
 * https://github.com/hughsk/png-chunks-extract
 * Extract the data chunks from a PNG file.
 * Useful for reading the metadata of a PNG image, or as the base of a more complete PNG parser.
 * Takes the raw image file data as a Uint8Array or Node.js Buffer, and returns an array of chunks. Each chunk has a name and data buffer:
 * @param data {Uint8Array}
 * @returns {[{name: String, data: Uint8Array}]}
 */
function extractChunks (data) {
	if (data[0] !== 0x89) throw new Error('Invalid .png file header')
	if (data[1] !== 0x50) throw new Error('Invalid .png file header')
	if (data[2] !== 0x4E) throw new Error('Invalid .png file header')
	if (data[3] !== 0x47) throw new Error('Invalid .png file header')
	if (data[4] !== 0x0D) throw new Error('Invalid .png file header: possibly caused by DOS-Unix line ending conversion?')
	if (data[5] !== 0x0A) throw new Error('Invalid .png file header: possibly caused by DOS-Unix line ending conversion?')
	if (data[6] !== 0x1A) throw new Error('Invalid .png file header')
	if (data[7] !== 0x0A) throw new Error('Invalid .png file header: possibly caused by DOS-Unix line ending conversion?')

	let ended = false
	let chunks = []
	let idx = 8

	while (idx < data.length) {
		// Read the length of the current chunk,
		// which is stored as a Uint32.
		uint8[3] = data[idx++]
		uint8[2] = data[idx++]
		uint8[1] = data[idx++]
		uint8[0] = data[idx++]

		// Chunk includes name/type for CRC check (see below).
		let length = uint32[0] + 4
		let chunk = new Uint8Array(length)
		chunk[0] = data[idx++]
		chunk[1] = data[idx++]
		chunk[2] = data[idx++]
		chunk[3] = data[idx++]

		// Get the name in ASCII for identification.
		let name = (
			String.fromCharCode(chunk[0]) +
			String.fromCharCode(chunk[1]) +
			String.fromCharCode(chunk[2]) +
			String.fromCharCode(chunk[3])
		)

		// The IHDR header MUST come first.
		if (!chunks.length && name !== 'IHDR') {
			throw new Error('IHDR header missing')
		}

		// The IEND header marks the end of the file,
		// so on discovering it break out of the loop.
		if (name === 'IEND') {
			ended = true
			chunks.push({
				name: name,
				data: new Uint8Array(0)
			})

			break
		}

		// Read the contents of the chunk out of the main buffer.
		for (let i = 4; i < length; i++) {
			chunk[i] = data[idx++]
		}

		// Read out the CRC value for comparison.
		// It's stored as an Int32.
		uint8[3] = data[idx++]
		uint8[2] = data[idx++]
		uint8[1] = data[idx++]
		uint8[0] = data[idx++]

		// The chunk data is now copied to remove the 4 preceding
		// bytes used for the chunk name/type.
		let chunkData = new Uint8Array(chunk.buffer.slice(4))

		chunks.push({
			name: name,
			data: chunkData
		})
	}

	return chunks
}

/**
 * read 4 bytes number from UInt8Array.
 * @param uint8array
 * @param offset
 * @returns {number}
 */
function readUint32 (uint8array,offset) {
	let byte1, byte2, byte3, byte4;
	byte1 = uint8array[offset++];
	byte2 = uint8array[offset++];
	byte3 = uint8array[offset++];
	byte4 = uint8array[offset];
	return  0 | (byte1 << 24) | (byte2 << 16) | (byte3 << 8) | byte4;
}

/**
 * Get object with PNG metadata. only tEXt and pHYs chunks are parsed
 * @param buffer {Buffer}
 * @returns {{tEXt: {keyword: value}, pHYs: {x: number, y: number, units: RESOLUTION_UNITS}, [string]: true}}
 */
function readMetadata(buffer){
	let result = {};
	const chunks = extractChunks(buffer);
	chunks.forEach( chunk => {
		switch(chunk.name){
			case 'tEXt':
				if (!result.tEXt) {
					result.tEXt = {};
				}
				let textChunk = textDecode(chunk.data);
				result.tEXt[textChunk.keyword] = textChunk.text;
				break
			case 'pHYs':
				result.pHYs = {
					// Pixels per unit, X axis: 4 bytes (unsigned integer)
					"x": readUint32(chunk.data, 0),
					// Pixels per unit, Y axis: 4 bytes (unsigned integer)
					"y":  readUint32(chunk.data, 4),
					"unit": chunk.data[8],
				}
				break
			case 'gAMA':
			case 'cHRM':
			case 'sRGB':
			case 'IHDR':
			case 'iCCP':
			default:
				result[chunk.name] = true;
		}
	})
	return result;
}
