/*
 Copyright (c) 2017-2018 amano <amano@miku39.jp>

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

var WindowManage = {

    onResize: function(){
        let tab_content = $( '.tab-content' );
        let positionY = $( window ).outerHeight() - $( 'footer' ).outerHeight();
        let rect = tab_content[0].getBoundingClientRect();
        let y = rect.top + window.pageYOffset;
        let h = positionY - y;
        tab_content.outerHeight( h );

        $( '#my-alert' )[0].style.bottom = `${$( 'footer' ).outerHeight()}px`;
    }
};

window.addEventListener( 'resize', ( ev ) =>{
    WindowManage.onResize();
} );


window.addEventListener( 'load', async ( ev ) =>{
    WindowManage.onResize();

    // Macだとウィンドウ開いた直後に画面が表示されないので
    // ちょっとサイズを変更して再描画がかかるようにする
    let x = window.screenX;
    let y = window.screenY;
    let w = window.outerWidth;
    let h = window.outerHeight;
    let win = await browser.windows.getCurrent();
    await browser.windows.update( win.id, {
        left: x,
        top: y,
        width: w + 1,
        height: h
    } );

    let tmp = localStorage.getItem( 'window_position' );
    if( tmp ){
        // TODO ウィンドウ位置とサイズを復元
        let pos = JSON.parse( tmp );

        // ウィンドウ位置サイズを復元
        let win = await browser.windows.getCurrent();
        if( pos ){
            if( pos.x < 0 ) pos.x = 0;
            if( pos.y < 0 ) pos.y = 0;
            browser.windows.update( win.id, {
                left: pos.x,
                top: pos.y,
                // width: pos.w,
                // height: pos.h
                width: w,
                height: h
            } )
        }
    }

    let active_tab = localStorage.getItem( 'active_tab' ) || '#tab-request';
    console.log( `Active tab: ${active_tab}` );
    $( `header a[href="${active_tab}"]` ).tab( 'show' );

    // アクティブタブを設定
    $( `a[data-toggle="tab"][href="${active_tab}"]` ).addClass( 'active' );
} );

window.addEventListener( 'unload', ( ev ) =>{
    // browser.storageは非同期処理のためこのタイミングでは書き込みできないので
    // ウィンドウ閉じるタイミングで保存したいデータは window.localStorage に書き込みする

    // アクティブタブを保存
    let target = $( 'a[data-toggle="tab"].active' ).attr( "href" );
    localStorage.setItem( 'active_tab', target );

    // ウィンドウ位置とサイズを保存
    let x = window.screenX;
    let y = window.screenY;
    let w = window.outerWidth;
    let h = window.outerHeight;
    let window_position = {
        x: x,
        y: y,
        w: w,
        h: h
    };
    localStorage.setItem( 'window_position', JSON.stringify( window_position ) );
} );


// ストックタブ以外ではドロップしてページ遷移とかしないように禁止する.
let cancelEvent = ( ev ) =>{
    ev.preventDefault();
    ev.stopPropagation();
    return false;
};
$( window ).on( 'dragenter', ( ev ) =>{
    return cancelEvent( ev );
} );
$( window ).on( 'dragover', ( ev ) =>{
    return cancelEvent( ev );
} );
$( window ).on( 'drop', ( ev ) =>{
    return cancelEvent( ev );
} );
