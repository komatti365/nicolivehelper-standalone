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


function Comm( addr, subproto ){
    this.addr = addr;
    this.subproto = subproto;
}

Comm.prototype.connect = function(){
    console.log( `connect to websocket ${this.addr}` );
    try{
        if( this.subproto ){
            this.socket = new WebSocket( this.addr, this.subproto );
        }else{
            this.socket = new WebSocket( this.addr );
        }
        return this.socket;
    }catch( x ){
        console.log( `サーバーへの接続に失敗しました。再接続してください。` );
        return undefined;
    }
};

Comm.prototype.onConnect = function( f ){
    if( this.socket ){
        this.socket.addEventListener( 'open', ( event ) =>{
            f( event );
        } );
    }
};

Comm.prototype.onReceive = function( f ){
    if( this.socket ){
        this.socket.addEventListener( 'message', ( event ) =>{
            f( event );
        } );
    }
};

Comm.prototype.onError = function( f ){
    if( this.socket ){
        this.socket.addEventListener( 'error', ( event ) =>{
            f( event );
        } );
    }
};

Comm.prototype.onClose = function( f ){
    if( this.socket ){
        this.socket.addEventListener( 'close', ( event ) =>{
            f( event );
        } );
    }
};

Comm.prototype.isOpen = function(){
    return !!( this.socket && this.socket.readyState === WebSocket.OPEN );
};

Comm.prototype.send = function( str ){
    if( this.socket && this.socket.readyState === WebSocket.OPEN ){
        this.socket.send( str );
    }else{
        console.warn( '[Comm] Cannot send message, socket is not open. readyState:', this.socket ? this.socket.readyState : 'no socket' );
    }
};

Comm.prototype.close = function( code, reason ){
    if( this.socket ){
        try{
            this.socket.close( code, reason );
        }catch( e ){
            console.error( '[Comm] Error closing socket:', e );
        }
    }
};
