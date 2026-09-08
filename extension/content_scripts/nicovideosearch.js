/*
 Copyright (c) 2018 amano <amano@miku39.jp>

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
 */


console.log( `${document.location.href}` );


// ニコニ広告動画は含まれない
let items = EvaluateXPath( document, "//div[contains(@class, 'itemThumb')]/@data-id" );
console.log( items );
let videos = [];
for( let i = 0, item; item = items[i]; i++ ){
    console.log( item.textContent );
    videos.push( item.textContent );
}

browser.runtime.onMessage.addListener( request =>{
    console.log( "Message from the background script:" );
    console.log( request.cmd );
    CopyToClipboard( videos.join( ' ' ) );

    return Promise.resolve( {response: videos} );
} );
