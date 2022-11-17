// ==UserScript==
// @name         png metadata discord
// @author       moonshine
// @version      1.0
// @updateURL    https://raw.githubusercontent.com/moonshinegloss/stable-diffusion-discord-prompts/main/discord-prompt.user.js
// @match        https://discord.com/channels/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=discord.com
// @grant        GM.xmlHttpRequest
// ==/UserScript==

(async function() {
    'use strict';
    while(!document.querySelector(".chatContent-3KubbW")) {
        await new Promise(r => setTimeout(r, 500));
    }

    let observer = new MutationObserver(mutationRecords => {
        const images = [...new Set(mutationRecords.filter(x => {
            const source = x?.target?.firstChild?.src
            return !!source && source.includes(".png") && source.includes("media.") && source.includes("attachments")
        }).map(x => x?.target?.firstChild))];

        if(images.length == 0) return;

        for(let i = 0; i < images.length; i++) {
            let url = images[i].src.replace("media.discordapp.net","cdn.discordapp.com")
            GM.xmlHttpRequest({
                method: "GET",
                url,
                responseType: "arraybuffer",
                onload: async function(res) {
                    try {
                        if(res?.response) {
                            const container_selector = images[i].closest(".messageAttachment-CZp8Iv")
                            const meta = readMetadata(new Uint8Array(res.response));
                            if(meta?.tEXt?.parameters && !container_selector.querySelector("#metadata")) {
                                container_selector.innerHTML = `<button onclick="alert(\`${meta.tEXt.parameters}\`)" style="position: absolute;z-index: 9999;">Reveal Prompt</button>` + container_selector.innerHTML
                            }
                        }
                    }catch(err){
                        console.log(err)
                    }
                }
            });
        }
    });

    // observe everything except attributes
    observer.observe(document.querySelector(".app-2CXKsg"), {
        childList: true, // observe direct children
        subtree: true, // and lower descendants too
        characterDataOldValue: true // pass old data to callback
    });
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
