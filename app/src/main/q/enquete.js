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

var Enquete = {

    setDefault: function(){
        let history = window.opener.NicoLiveHistory.history;
        let n = history.length;

        let ans = $( '.answer' );
        for( let i = n - 4, j = 0; i < n; i++, j++ ){
            if( i < 0 ) continue;
            console.log( history[i].title );
            $( ans[j] ).val( history[i].title );
        }
    },

    init: function(){
        try{
            document.title = `アンケート ${window.opener.NicoLiveHelper.getLiveId()}`;
        }catch( e ){
        }

        $( '#set-from-history' ).on( 'click', ( ev ) =>{
            this.setDefault();
        } );

        $( '#post' ).on( 'click', ( ev ) =>{
            let inp = $( 'input' );
            let params = [];
            for( let i = 0, item; item = inp[i]; i++ ){
                params.push( item.value );
            }
            console.log( params );
            window.opener.NicoLiveHelper.enquete(
                params[0],
                params[1], params[2], params[3],
                params[4], params[5], params[6],
                params[7], params[8], params[9] );
        } );

        $( '#result' ).on( 'click', ( ev ) =>{
            window.opener.NicoLiveHelper.enqueteShowResult();
        } );
        $( '#clear_result' ).on( 'click', ( ev ) =>{
            window.opener.NicoLiveHelper.enqueteEnd();
        } );

        $( '#clear' ).on( 'click', ( ev ) =>{
            $( 'input' ).val( '' );
        } )
    }
};

window.addEventListener( 'load', ( ev ) =>{
    Enquete.init();
} );
