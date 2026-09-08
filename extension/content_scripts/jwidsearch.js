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

console.log( document.location.href );
let frame = document.querySelector( 'frame' );

frame.addEventListener( 'load', async () =>{
    let result = await browser.storage.local.get( 'jwid' );
    result = result.jwid;

    let code = result.code || '';
    console.log( code );
    let inputcode = EvaluateXPath( frame.contentDocument, "//input[@name='IN_WORKS_CD']" )[0];
    inputcode.value = code;

    let title = result.title || '';
    console.log( title );
    inputcode = EvaluateXPath( frame.contentDocument, "//input[@name='IN_WORKS_TITLE_NAME1']" )[0];
    inputcode.value = title;

    if( code || title ){
        let submit = EvaluateXPath( frame.contentDocument, "//input[@name='CMD_SEARCH']" )[0];
        submit.click();

        // clear
        browser.storage.local.set( {'jwid': {}} )
    }
} );

