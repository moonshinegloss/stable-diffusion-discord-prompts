// ==UserScript==
// @name         png metadata discord
// @author       moonshine
// @version      1.7
// @updateURL    https://raw.githubusercontent.com/moonshinegloss/stable-diffusion-discord-prompts/main/discord-prompt.user.js
// @match        https://discord.com/channels/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=discord.com
// @grant        GM.xmlHttpRequest
// @grant        GM_addStyle
// ==/UserScript==

const ignoreDMs = true;

async function refreshImages(nodes) {
    nodes = nodes || document.querySelectorAll("div[class*='imageWrapper-'] img");
    for(let i = 0; i < nodes.length; i++) {
        let url = nodes[i].src.replace("media.discordapp.net","cdn.discordapp.com")
        GM.xmlHttpRequest({
            method: "GET",
            url,
            responseType: "arraybuffer",
            onload: async function(res) {
                try {
                    if(res?.response) {
                        const container_selector = nodes[i].closest("div[class*='messageAttachment-']")
                        const meta = readMetadata(new Uint8Array(res.response));
                        let params = meta?.tEXt?.parameters

                        if(!params && meta?.tEXt?.Dream) {
                            params = `${meta?.tEXt?.Dream} ${meta?.tEXt['sd-metadata']}`
                        }

                        // ignore images that have been processed already
                        if(params && !container_selector.className.includes("prompt-preview-container")) {
                            // style the image preview, while preserving discord click events for spoilers/lightbox
                            nodes[i].closest("div[class*='imageWrapper-']").classList.add("prompt-preview");
                            nodes[i].closest("div[class*='spoilerContainer-']")?.classList.add("prompt-preview");

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
                    }
                }catch(err){
                    console.log(err)
                }
            }
        });
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
            return !!source && source.includes(".png") && source.includes("media.") && source.includes("attachments")
        }).map(x => x?.target?.firstChild))];

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
    GM_addStyle(`
          /* thanks to archon */
          details[open] + div{
            border-top: 0 !important;
            border-top-right-radius: 0 !important;
          }

          .promptTXT {
            border: 3px solid ${borderColor};
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
			} else {
				throw new Error('Invalid NULL character found. 0x00 character is not permitted in tEXt content')
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

	if (!ended) {
		throw new Error('.png file ended prematurely: no IEND header was found')
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
